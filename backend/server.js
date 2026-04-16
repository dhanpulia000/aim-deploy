// 서버 시작 파일 (포트 리스닝만 담당)

// Load environment variables first
require("dotenv").config();

// Validate environment variables before anything else
const { validateEnv } = require("./utils/env");
validateEnv();

const app = require("./app");
const { checkConnection, disconnect, query } = require("./libs/db");
const logger = require("./utils/logger");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const kill = require("tree-kill");

// exec를 Promise로 변환
const execAsync = promisify(exec);

// 포트 설정 (환경 변수가 없으면 기본값 사용)
// WebSocket 서버를 HTTP 서버에 통합하여 단일 포트만 사용
const PORT = Number(process.env.PORT) || 9080; // AIMGLOBAL 기본(원본 8080과 분리)
const BIND_ADDRESS = process.env.BIND_ADDRESS || "0.0.0.0";

// WebSocket에서 사용할 에이전트 실시간 조회 함수 (전역 범위에 정의)
async function fetchAgentsForRealtime() {
  try {
    const agents = query(
      "SELECT * FROM Agent WHERE isActive = ? ORDER BY name ASC",
      [1],
    );

    return agents.map((agent) => ({
      ...agent,
      isActive: Boolean(agent.isActive),
      // DB에는 문자열(JSON)로 저장되어 있으므로 배열로 변환
      channelFocus: agent.channelFocus ? JSON.parse(agent.channelFocus) : [],
    }));
  } catch (error) {
    logger.error("[Realtime] Failed to load agents for WebSocket", {
      error: error.message,
    });
    return [];
  }
}

/**
 * 포트를 사용 중인 프로세스 종료 (Windows / Linux·macOS 공통)
 * Linux에서 미동작 시 재시작할 때마다 기존 프로세스가 남아 포트·프로세스가 쌓일 수 있음
 */
async function killProcessOnPort(port) {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      // Windows: netstat + taskkill
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const match = line.match(/LISTENING\s+(\d+)/);
        if (match) {
          const pid = match[1];
          logger.info(`[PortManager] Killing process ${pid} on port ${port}`);
          try {
            await execAsync(`taskkill /PID ${pid} /F`);
            logger.info(`[PortManager] Process ${pid} killed successfully`);
          } catch (killError) {
            logger.warn(`[PortManager] Failed to kill process ${pid}`, {
              error: killError.message,
            });
          }
        }
      }
    } else {
      // Linux / macOS: lsof로 포트 사용 프로세스 찾아 종료
      let stdout = "";
      try {
        const result = await execAsync(`lsof -ti:${port}`, {
          encoding: "utf8",
        });
        stdout = result.stdout || "";
      } catch (e) {
        // lsof는 포트 사용 프로세스 없으면 exit 1
        if (e.code === 1) {
          logger.debug(`[PortManager] No process found on port ${port}`);
          return;
        }
        throw e;
      }
      const pids =
        stdout && stdout.trim()
          ? stdout.trim().split(/\s+/).filter(Boolean)
          : [];
      for (const pid of pids) {
        if (!/^\d+$/.test(pid)) continue;
        logger.info(`[PortManager] Killing process ${pid} on port ${port}`);
        try {
          process.kill(Number(pid), "SIGTERM");
          logger.info(`[PortManager] Process ${pid} killed successfully`);
        } catch (killErr) {
          if (killErr.code !== "ESRCH") {
            logger.warn(`[PortManager] Failed to kill process ${pid}`, {
              error: killErr.message,
            });
          }
        }
      }
      if (pids.length === 0) {
        logger.debug(`[PortManager] No process found on port ${port}`);
      }
    }
  } catch (error) {
    if (isWin && (error.code === 1 || error.message.includes("findstr"))) {
      logger.debug(`[PortManager] No process found on port ${port}`);
    } else if (!isWin && (error.code === 1 || error.message.includes("lsof"))) {
      logger.debug(`[PortManager] No process found on port ${port}`);
    } else {
      logger.warn(`[PortManager] Error checking port ${port}`, {
        error: error.message,
      });
    }
  }
}

// 모니터링 워커 프로세스 관리
const workerProcesses = new Map(); // workerName -> { process, restartTimeout }
const workerRestartCount = new Map(); // workerName -> 연속 비정상 종료 횟수 (정상 종료 시 리셋)
const WORKER_RESTART_DELAY_MS = 15000; // 15초 후 재시작 (과부하·크래시 루프 완화)
const MAX_RESTARTS_BEFORE_BACKOFF = 3; // 이 횟수 초과 시 exponential backoff 적용
let serverShuttingDown = false; // graceful shutdown 시 워커 재시작 방지

/**
 * Naver Cafe 모니터링 스케줄러
 * 활성화된 MonitoredUrl을 주기적으로 스크래핑하여 Issue/Comment로 변환
 */
async function scanMonitoredUrls() {
  try {
    const { query, execute } = require("./libs/db");
    const {
      fetchNaverCafePost,
    } = require("./services/scraper/naverCafeScraper");
    const {
      upsertIssueFromNaverCafe,
    } = require("./services/naverCafeIssues.service");

    const urls = query("SELECT * FROM MonitoredUrl WHERE enabled = ?", [1]);

    if (urls.length === 0) {
      return; // 모니터링할 URL이 없으면 종료
    }

    const now = new Date();
    logger.debug("[NaverCafeScheduler] Scanning monitored URLs", {
      count: urls.length,
    });

    for (const mu of urls) {
      // Interval 체크: lastRunAt이 최근이면 스킵
      if (mu.lastRunAt) {
        const diffSec =
          (now.getTime() - new Date(mu.lastRunAt).getTime()) / 1000;
        if (diffSec < mu.interval) {
          logger.debug("[NaverCafeScheduler] Skipping (too recent)", {
            url: mu.url,
            lastRunAt: mu.lastRunAt,
            interval: mu.interval,
          });
          continue;
        }
      }

      try {
        logger.info("[NaverCafeScheduler] Fetching", {
          url: mu.url,
          cafeGame: mu.cafeGame,
        });

        const { post, comments } = await fetchNaverCafePost(
          mu.url,
          mu.cafeGame,
        );

        await upsertIssueFromNaverCafe({
          url: mu.url,
          cafeGame: mu.cafeGame,
          post,
          comments,
          monitoredUrlId: mu.id,
        });

        // lastRunAt 업데이트
        execute(
          "UPDATE MonitoredUrl SET lastRunAt = ?, updatedAt = ? WHERE id = ?",
          [now.toISOString(), now.toISOString(), mu.id],
        );

        logger.info("[NaverCafeScheduler] Success", {
          url: mu.url,
          postId: post.externalPostId,
          commentsCount: comments.length,
        });
      } catch (err) {
        logger.error("[NaverCafeScheduler] Failed for URL", {
          url: mu.url,
          error: err.message,
          stack: err.stack,
        });
        // 개별 URL 실패는 전체 스케줄러를 중단하지 않음
      }
    }
  } catch (err) {
    logger.error("[NaverCafeScheduler] Unexpected error", {
      error: err.message,
      stack: err.stack,
    });
  }
}

/**
 * 스크린샷 정리 스케줄러 시작
 * 매일 자정에 10일이 지난 스크린샷 파일 삭제
 */
function startScreenshotCleanupScheduler() {
  const {
    cleanupOldScreenshots,
  } = require("./services/screenshotCleanup.service");

  logger.info("[ScreenshotCleanup] Starting scheduler (daily at midnight)");

  // 다음 자정까지의 시간 계산
  const getNextMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // 다음 자정
    return midnight.getTime() - now.getTime();
  };

  // 첫 실행: 다음 자정에 실행
  const firstRunDelay = getNextMidnight();
  setTimeout(() => {
    cleanupOldScreenshots().catch((err) => {
      logger.error("[ScreenshotCleanup] Scheduled cleanup failed", {
        error: err.message,
      });
    });

    // 이후 매일 자정에 실행
    setInterval(
      () => {
        cleanupOldScreenshots().catch((err) => {
          logger.error("[ScreenshotCleanup] Scheduled cleanup failed", {
            error: err.message,
          });
        });
      },
      24 * 60 * 60 * 1000,
    ); // 24시간
  }, firstRunDelay);

  logger.info("[ScreenshotCleanup] Scheduler started", {
    firstRunIn: Math.floor(firstRunDelay / 1000 / 60),
    interval: "24 hours",
  });
}

/**
 * Naver Cafe 스케줄러 시작
 * 60초마다 활성화된 URL을 스캔
 */
function startNaverCafeScheduler() {
  logger.info("[NaverCafeScheduler] Starting scheduler (60s interval)");

  // 시작 시 즉시 한 번 실행
  scanMonitoredUrls().catch((err) => {
    logger.error("[NaverCafeScheduler] Initial scan failed", {
      error: err.message,
    });
  });

  // 60초마다 실행
  setInterval(() => {
    scanMonitoredUrls().catch((err) => {
      logger.error("[NaverCafeScheduler] Scheduled scan crashed", {
        error: err.message,
      });
    });
  }, 60_000); // 60초
}

/**
 * 게시판 스캐너 시작 (레거시 - deprecated)
 * 새로운 모니터링 워커로 대체됨
 */
function startBoardScanner() {
  // 레거시 스케줄러는 비활성화 (새로운 워커 프로세스 사용)
  logger.info(
    "[BoardScanner] Legacy scanner disabled (using worker processes)",
  );
}

/**
 * 모니터링 워커 프로세스 시작
 */
function startMonitoringWorker(workerName, scriptPath) {
  const workerPath = path.join(__dirname, scriptPath);

  logger.info(`[WorkerManager] Starting ${workerName}`, { script: workerPath });

  const workerProcess = spawn("node", [workerPath], {
    cwd: __dirname,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    detached: false, // 부모 프로세스와 연결 유지 (좀비 프로세스 방지)
    killSignal: "SIGTERM", // 기본 종료 시그널
  });

  // 표준 출력 처리
  workerProcess.stdout.on("data", (data) => {
    logger.info(`[${workerName}]`, { output: data.toString().trim() });
  });

  // 표준 에러 처리
  workerProcess.stderr.on("data", (data) => {
    logger.error(`[${workerName}]`, { error: data.toString().trim() });
  });

  // 프로세스 종료 처리
  workerProcess.on("exit", (code, signal) => {
    logger.warn(`[WorkerManager] ${workerName} exited`, { code, signal });

    // 재시작 예약 취소 (이미 종료된 경우)
    const workerInfo = workerProcesses.get(workerName);
    if (workerInfo && workerInfo.restartTimeout) {
      clearTimeout(workerInfo.restartTimeout);
    }

    // 서버가 graceful shutdown 중이면 재시작하지 않음
    if (serverShuttingDown) {
      workerProcesses.delete(workerName);
      workerRestartCount.delete(workerName);
      return;
    }

    // 정상 종료(code 0)이면 재시작 카운트 리셋
    if (code === 0) {
      workerRestartCount.set(workerName, 0);
    } else {
      const count = (workerRestartCount.get(workerName) || 0) + 1;
      workerRestartCount.set(workerName, count);
    }

    // 연속 크래시 시 exponential backoff (3회 이후 30s → 60s → 120s ...)
    const count = workerRestartCount.get(workerName) || 0;
    const delayMs =
      count > MAX_RESTARTS_BEFORE_BACKOFF
        ? WORKER_RESTART_DELAY_MS *
          Math.pow(2, count - MAX_RESTARTS_BEFORE_BACKOFF)
        : WORKER_RESTART_DELAY_MS;

    logger.info(`[WorkerManager] Restarting ${workerName} in ${delayMs}ms`, {
      code,
      signal,
      restartCount: count,
    });
    const restartTimeout = setTimeout(() => {
      logger.info(`[WorkerManager] Restarting ${workerName}...`);
      startMonitoringWorker(workerName, scriptPath);
    }, delayMs);

    workerProcesses.set(workerName, {
      process: null,
      restartTimeout,
    });
  });

  // 프로세스 에러 처리
  workerProcess.on("error", (error) => {
    logger.error(`[WorkerManager] ${workerName} process error`, {
      error: error.message,
      stack: error.stack,
    });
  });

  // 워커 정보 저장
  workerProcesses.set(workerName, {
    process: workerProcess,
    restartTimeout: null,
  });

  return workerProcess;
}

function isTruthyEnv(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/**
 * 모든 모니터링 워커 시작
 */
function startAllMonitoringWorkers() {
  logger.info("[WorkerManager] Starting all monitoring workers");

  // 네이버 카페 Playwright 워커 3종 — 로컬에서 끄려면 DISABLE_NAVER_CAFE_WORKERS=true
  if (isTruthyEnv(process.env.DISABLE_NAVER_CAFE_WORKERS)) {
    logger.info(
      "[WorkerManager] Naver Cafe workers skipped (DISABLE_NAVER_CAFE_WORKERS is set)",
    );
  } else {
    startMonitoringWorker(
      "naverCafe",
      "workers/monitoring/naverCafe.worker.js",
    );
    startMonitoringWorker(
      "naverCafeClan",
      "workers/monitoring/naverCafeClan.worker.js",
    );
    startMonitoringWorker(
      "naverCafeBackfill",
      "workers/monitoring/naverCafeBackfill.worker.js",
    );
  }

  // Discord 워커 (토큰이 설정된 경우만)
  if (process.env.DISCORD_BOT_TOKEN) {
    startMonitoringWorker("discord", "workers/monitoring/discord.worker.js");
  } else {
    logger.info(
      "[WorkerManager] Discord worker skipped (DISCORD_BOT_TOKEN not set)",
    );
  }

  // playinzoi Discourse 포럼 → RawLog (DISCOURSE_INZOI_ENABLED=true 일 때만)
  if (isTruthyEnv(process.env.DISCOURSE_INZOI_ENABLED)) {
    startMonitoringWorker(
      "discourseInzoi",
      "workers/monitoring/discourseInzoi.worker.js",
    );
  } else {
    logger.info(
      "[WorkerManager] Discourse inZOI worker skipped (set DISCOURSE_INZOI_ENABLED=true to enable)",
    );
  }

  // Slack 공지사항 수집 워커 (토큰과 채널 ID가 설정된 경우만)
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_NOTICE_CHANNEL_ID) {
    startMonitoringWorker(
      "slackNotice",
      "workers/ingestion/slackNotice.worker.js",
    );
  } else {
    logger.info(
      "[WorkerManager] Slack notice worker skipped (SLACK_BOT_TOKEN or SLACK_NOTICE_CHANNEL_ID not set)",
    );
  }

  // 업무 알림 워커 (LINE 및/또는 Discord 전송, LINE 토큰 없어도 Discord만 있으면 동작)
  startMonitoringWorker(
    "taskNotification",
    "workers/taskNotification.worker.js",
  );
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    logger.info(
      "[WorkerManager] Task notification worker: LINE_CHANNEL_ACCESS_TOKEN not set (Discord-only 알림만 전송 가능)",
    );
  }

  // RawLog → Issue 승격 워커
  startMonitoringWorker("rawLogProcessor", "workers/rawLogProcessor.worker.js");

  // 네이버 카페 이슈 댓글 주기 감시 (관리 모드 ON 이슈만)
  if (process.env.ISSUE_COMMENT_WATCH_ENABLED === "true") {
    startMonitoringWorker(
      "issueCommentWatch",
      "workers/monitoring/issueCommentWatch.worker.js",
    );
  } else {
    logger.info(
      "[WorkerManager] Issue comment watch worker skipped (set ISSUE_COMMENT_WATCH_ENABLED=true to enable)",
    );
  }

  // inZOI standalone monitor (default ON, set INZOI_STANDALONE_ENABLED=false to disable)
  if (
    !["0", "false", "no"].includes(
      String(process.env.INZOI_STANDALONE_ENABLED ?? "true")
        .trim()
        .toLowerCase(),
    )
  ) {
    startMonitoringWorker("inzoiStandalone", "../integrations/monitor.js");
  } else {
    logger.info(
      "[WorkerManager] inZOI standalone worker skipped (INZOI_STANDALONE_ENABLED=false)",
    );
  }
}

/**
 * 모든 모니터링 워커 종료 (강화된 버전)
 * 좀비 프로세스 방지 및 타임아웃 처리 포함
 */
async function stopAllMonitoringWorkers() {
  logger.info("[WorkerManager] Stopping all monitoring workers");

  const stopPromises = [];
  const KILL_TIMEOUT_MS = 10000; // 10초 타임아웃

  for (const [workerName, workerInfo] of workerProcesses.entries()) {
    // 재시작 타임아웃 취소
    if (workerInfo.restartTimeout) {
      clearTimeout(workerInfo.restartTimeout);
    }

    if (workerInfo.process) {
      logger.info(
        `[WorkerManager] Stopping ${workerName} (PID: ${workerInfo.process.pid})`,
      );

      const stopPromise = new Promise((resolve) => {
        const pid = workerInfo.process.pid;
        let killed = false;
        let timeoutId = null;

        // 프로세스 종료 이벤트 핸들러
        const onExit = (code, signal) => {
          if (!killed) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            killed = true;
            logger.info(`[WorkerManager] ${workerName} exited`, {
              code,
              signal,
              pid,
            });
            resolve();
          }
        };

        // 프로세스가 이미 종료된 경우를 대비해 이벤트 리스너 등록
        workerInfo.process.on("exit", onExit);

        // 타임아웃 설정: 일정 시간 내 종료되지 않으면 강제 종료
        timeoutId = setTimeout(() => {
          if (!killed) {
            logger.warn(
              `[WorkerManager] Force killing ${workerName} after timeout (${KILL_TIMEOUT_MS}ms)`,
              { pid },
            );
            try {
              kill(pid, "SIGKILL", (killErr) => {
                if (killErr) {
                  logger.error(
                    `[WorkerManager] Failed to force kill ${workerName}`,
                    {
                      error: killErr.message,
                      pid,
                    },
                  );
                } else {
                  logger.info(`[WorkerManager] ${workerName} force killed`, {
                    pid,
                  });
                }
                killed = true;
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }
                resolve();
              });
            } catch (killErr) {
              logger.error(
                `[WorkerManager] Exception during force kill of ${workerName}`,
                {
                  error: killErr.message,
                  pid,
                },
              );
              killed = true;
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              resolve();
            }
          }
        }, KILL_TIMEOUT_MS);

        // SIGTERM 전송 (graceful shutdown)
        try {
          kill(pid, "SIGTERM", (err) => {
            if (err) {
              logger.error(
                `[WorkerManager] Failed to send SIGTERM to ${workerName}`,
                {
                  error: err.message,
                  pid,
                },
              );
              // SIGTERM 실패 시 즉시 SIGKILL 시도
              try {
                kill(pid, "SIGKILL", (killErr) => {
                  if (killErr) {
                    logger.error(
                      `[WorkerManager] Failed to send SIGKILL to ${workerName}`,
                      {
                        error: killErr.message,
                        pid,
                      },
                    );
                  }
                  killed = true;
                  if (timeoutId) {
                    clearTimeout(timeoutId);
                  }
                  resolve();
                });
              } catch (killErr) {
                logger.error(
                  `[WorkerManager] Exception sending SIGKILL to ${workerName}`,
                  {
                    error: killErr.message,
                    pid,
                  },
                );
                killed = true;
                if (timeoutId) {
                  clearTimeout(timeoutId);
                }
                resolve();
              }
            } else {
              logger.debug(`[WorkerManager] SIGTERM sent to ${workerName}`, {
                pid,
              });
              // 프로세스가 종료될 때까지 대기 (onExit 핸들러가 처리)
            }
          });
        } catch (err) {
          logger.error(
            `[WorkerManager] Exception sending SIGTERM to ${workerName}`,
            {
              error: err.message,
              pid,
            },
          );
          killed = true;
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve();
        }
      });

      stopPromises.push(stopPromise);
    }
  }

  // 모든 프로세스 종료 대기
  await Promise.all(stopPromises);
  workerProcesses.clear();
  logger.info("[WorkerManager] All monitoring workers stopped");
}

// 데이터베이스 연결 확인
async function startServer() {
  try {
    // 포트 충돌 해결: 기존 프로세스 종료
    logger.info(`[PortManager] Checking port ${PORT}...`);
    await killProcessOnPort(PORT);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // 1초 대기

    // 데이터베이스 경로 로그
    logger.info("Database URL:", { DATABASE_URL: process.env.DATABASE_URL });

    // 데이터베이스 초기화 (스키마 생성)
    try {
      const { initDatabase, applyMigration } = require("./libs/init-db");
      const fs = require("fs");

      initDatabase();

      // 마이그레이션 적용
      const migrationsDir = path.join(__dirname, "migrations");
      if (fs.existsSync(migrationsDir)) {
        const migrationFiles = fs
          .readdirSync(migrationsDir)
          .filter((f) => f.endsWith(".sql"))
          .sort(); // 파일명 순서로 정렬

        for (const file of migrationFiles) {
          const migrationPath = path.join(migrationsDir, file);
          const migrationSql = fs.readFileSync(migrationPath, "utf8");
          try {
            applyMigration(file, migrationSql);
          } catch (migError) {
            logger.warn(`Migration ${file} failed (may already be applied)`, {
              error: migError.message,
            });
          }
        }
      }

      const {
        ensureCustomerFeedbackNoticeColumns,
        ensureWorkChecklistItemShowInColumns,
      } = require("./libs/ensureLegacySchema");
      ensureCustomerFeedbackNoticeColumns();
      ensureWorkChecklistItemShowInColumns();
    } catch (initError) {
      logger.warn(
        "Database initialization failed (may already be initialized)",
        {
          error: initError.message,
        },
      );
    }

    // 데이터베이스 연결 확인
    const isConnected = await checkConnection();
    app.set("dbAvailable", isConnected);
    if (!isConnected) {
      logger.warn(
        "Database connection unavailable. Running in degraded (mock/JSON) mode.",
      );
    } else {
      logger.info("Database connected successfully");

      // 이슈 개수 확인
      const { queryOne } = require("./libs/db");
      const issueCountResult = queryOne(
        "SELECT COUNT(*) as count FROM ReportItemIssue",
        [],
      );
      const issueCount = issueCountResult?.count || 0;
      logger.info("Total issues in database:", { count: issueCount });

      // SLA 워커는 WebSocket 서버가 초기화된 후에 시작
      // (아래에서 처리)

      // 레거시 스케줄러는 비활성화 (새로운 워커 프로세스 사용)
      // startNaverCafeScheduler();
      // startBoardScanner();

      // 새로운 모니터링 워커 프로세스 시작
      startAllMonitoringWorkers();

      // 스크린샷 정리 스케줄러 시작
      startScreenshotCleanupScheduler();

      // 모니터링 서비스에 워커 프로세스 맵 공유
      const monitoringService = require("./services/monitoring.service");
      monitoringService.setWorkerProcesses(workerProcesses);

      // 벡터 검색 서비스 초기화 (하이브리드: PostgreSQL + pgvector)
      try {
        const vectorSearchService =
          require("./services/vectorSearch.service").getVectorSearchService();
        // 비동기 초기화 (서버 시작을 지연시키지 않음)
        setImmediate(async () => {
          try {
            await vectorSearchService.init();
            if (vectorSearchService.isServiceAvailable()) {
              logger.info("[VectorSearch] Service initialized successfully");
            } else {
              logger.info(
                "[VectorSearch] Service not available (PostgreSQL + pgvector not configured, continuing with SQLite only)",
              );
            }
          } catch (error) {
            logger.warn(
              "[VectorSearch] Initialization failed (continuing without vector search)",
              {
                error: error.message,
              },
            );
          }
        });
      } catch (error) {
        logger.warn(
          "[VectorSearch] Failed to load vector search service (continuing without vector search)",
          {
            error: error.message,
          },
        );
      }
    }

    // 서버 시작
    const http = require("http");
    const server = http.createServer(app);
    // 파트너 영상 아카이빙 등 장시간 요청 허용 (10분, 기본 2분 초과 시 504 방지)
    server.timeout = 600000;

    try {
      const {
        ensureDirectories,
      } = require("./services/weeklyVocReportFromExcel.service");
      ensureDirectories("mobile");
      ensureDirectories("pc");
    } catch (e) {
      logger.warn("[Startup] weeklyVocReport directories init skipped", {
        error: e.message,
      });
    }

    server.listen(PORT, BIND_ADDRESS, () => {
      logger.info(`Server running on http://${BIND_ADDRESS}:${PORT}`);
      logger.info(`API available at http://localhost:${PORT}/api`);
    });

    // 서버 에러 처리
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        logger.error(
          `Port ${PORT} is already in use. Please stop the process using this port or change the PORT environment variable.`,
        );
        process.exit(1);
      } else {
        logger.error("Server error", { error: err.message, code: err.code });
        process.exit(1);
      }
    });

    // WebSocket 서버를 HTTP 서버에 통합 (단일 포트 사용)
    const WebSocket = require("ws");
    let wss;
    try {
      // HTTP 서버 인스턴스에 WebSocket 서버 attach
      // WebSocket 보안: Origin 검증 및 클라이언트 인증 옵션
      const allowedWsOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
        : process.env.NODE_ENV === "production"
          ? []
          : null; // 개발 환경에서는 null (모든 Origin 허용)

      wss = new WebSocket.Server({
        server: server, // HTTP 서버에 attach
        path: "/", // WebSocket 경로
        verifyClient: (info) => {
          // 프로덕션 환경에서만 Origin 검증
          if (
            process.env.NODE_ENV === "production" &&
            allowedWsOrigins &&
            allowedWsOrigins.length > 0
          ) {
            const origin = info.origin;
            if (!origin || !allowedWsOrigins.includes(origin)) {
              logger.warn("[WebSocket] Connection rejected: Invalid origin", {
                origin,
                allowedOrigins: allowedWsOrigins,
              });
              return false;
            }
          }
          return true;
        },
      });

      // WebSocket 서버 에러 처리
      wss.on("error", (err) => {
        logger.error("WebSocket server error", {
          error: err.message,
          code: err.code,
        });
      });

      logger.info(`WebSocket server attached to HTTP server on port ${PORT}`, {
        originValidation:
          process.env.NODE_ENV === "production" ? "enabled" : "disabled",
      });

      // app.locals에 wss 설정 (호환성을 위해)
      app.locals.wss = wss;

      // WebSocket Publisher 초기화
      const publisher = require("./realtime/publisher");
      publisher.setWebSocketServer(wss);
      logger.info("WebSocket publisher initialized");

      // SLA 워커는 DB가 있을 때만 (실패 시 동기 pg 호출이 이벤트 루프를 막음)
      if (isConnected) {
        const { startSlaWorker } = require("./workers/sla.worker");
        const slaIntervalMs =
          parseInt(process.env.SLA_CHECK_INTERVAL_MS) || 60000; // 기본 1분
        startSlaWorker(publisher, slaIntervalMs);
        logger.info("SLA worker started", { intervalMs: slaIntervalMs });
      } else {
        logger.info("SLA worker skipped (database unavailable at startup)");
      }
    } catch (err) {
      logger.error("Failed to create WebSocket server", {
        error: err.message,
        code: err.code,
      });
      server.close(() => {
        process.exit(1);
      });
      return;
    }

    // 핑/퐁 기반 헬스체크 — pong 누락 2회까지 허용 (백그라운드 탭 등에서 일시적 미응답 방지)
    const heartbeat = function () {
      this.isAlive = true;
      this.missedPongs = 0;
    };

    wss.on("connection", (ws) => {
      logger.info("WebSocket client connected");
      ws.isAlive = true;
      ws.missedPongs = 0;
      ws.on("pong", heartbeat);

      // 초기 데이터 전송 (타입화된 이벤트 형식: { type, payload })
      // DB의 Agent 테이블에서 활성 에이전트를 조회하여 전송
      fetchAgentsForRealtime()
        .then((agents) => {
          ws.send(
            JSON.stringify({
              type: "initial_state",
              payload: {
                agents: agents || [],
                // 티켓은 현재 REST API(/api/issues)를 통해 별도로 로드하므로 여기서는 빈 배열 전송
                tickets: [],
              },
            }),
          );
        })
        .catch((error) => {
          logger.error("[WebSocket] Failed to send initial_state", {
            error: error.message,
          });
          ws.send(
            JSON.stringify({
              type: "initial_state",
              payload: {
                agents: [],
                tickets: [],
              },
            }),
          );
        });

      // 주기적 업데이트 (타입화된 이벤트 형식: { type, payload }) — 15초 주기로 서버 부하 완화
      const WS_STATE_UPDATE_MS = 15000;
      const interval = setInterval(async () => {
        try {
          const agents = await fetchAgentsForRealtime();
          ws.send(
            JSON.stringify({
              type: "state_update",
              payload: {
                agents: agents || [],
                tickets: [],
                timestamp: Date.now(),
              },
            }),
          );
        } catch (error) {
          logger.error("[WebSocket] Failed to send state_update", {
            error: error.message,
          });
        }
      }, WS_STATE_UPDATE_MS);

      ws.on("close", () => {
        logger.info("WebSocket client disconnected");
        clearInterval(interval);
      });
    });
    // 주기적 헬스체크 (60초): pong 2회 연속 없을 때만 종료 — 백그라운드 탭/일시 지연 시 끊김 완화
    const WS_PING_INTERVAL_MS = 60000;
    const wsHealthInterval = setInterval(() => {
      wss.clients.forEach((socket) => {
        if (socket.isAlive === false) {
          socket.missedPongs = (socket.missedPongs || 0) + 1;
          if (socket.missedPongs >= 2) socket.terminate();
          return;
        }
        socket.isAlive = false;
        socket.ping();
      });
    }, WS_PING_INTERVAL_MS);

    // Graceful shutdown
    const cleanup = async () => {
      logger.info("Shutting down gracefully");

      // 모니터링 워커 종료
      await stopAllMonitoringWorkers();

      clearInterval(wsHealthInterval);
      wss.clients.forEach((socket) => socket.close());
      wss.close(() => logger.info("WebSocket server closed"));
      server.close(() => {
        logger.info("HTTP server closed");
        try {
          disconnect();
        } catch (err) {
          logger.warn("Database disconnect failed during shutdown", {
            error: err.message,
          });
        }
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, shutting down gracefully");
      serverShuttingDown = true;
      cleanup();
    });

    process.on("SIGINT", () => {
      logger.info("SIGINT received, shutting down gracefully");
      serverShuttingDown = true;
      cleanup();
    });

    // 프로세스 레벨 예외 처리로 안전성 향상
    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Promise rejection", { error: String(reason) });
    });
    process.on("uncaughtException", (err) => {
      logger.error("Uncaught Exception", {
        error: err.message,
        stack: err.stack,
      });
      // 포트 바인딩 실패는 이미 처리되었으므로 다른 예외만 처리
      if (err.code !== "EADDRINUSE") {
        cleanup();
        setTimeout(() => process.exit(1), 1000);
      } else {
        process.exit(1);
      }
    });
  } catch (error) {
    logger.error("Server startup failed", { error: error.message });
    process.exit(1);
  }
}

/**
 * 특정 워커 시작 (외부에서 호출 가능)
 * @param {string} workerName - 워커 이름
 * @param {string} scriptPath - 워커 스크립트 경로
 * @returns {Object|null} 시작된 워커 프로세스 또는 null
 */
function startWorker(workerName, scriptPath) {
  // 이미 실행 중인 워커가 있으면 종료
  const existingWorker = workerProcesses.get(workerName);
  if (existingWorker && existingWorker.process) {
    const process = existingWorker.process;
    if (process.exitCode === null && !process.killed) {
      logger.info(
        `[WorkerManager] Stopping existing ${workerName} before restart`,
      );
      try {
        process.kill("SIGTERM");
      } catch (err) {
        logger.error(`[WorkerManager] Failed to stop existing ${workerName}`, {
          error: err.message,
        });
      }
    }
    // 재시작 타임아웃 취소
    if (existingWorker.restartTimeout) {
      clearTimeout(existingWorker.restartTimeout);
    }
  }

  // 워커 시작
  return startMonitoringWorker(workerName, scriptPath);
}

/**
 * 슬랙 공지 수집 워커 시작
 * @returns {Object|null} 시작된 워커 프로세스 또는 null
 */
function startSlackNoticeWorker() {
  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_NOTICE_CHANNEL_ID) {
    logger.warn(
      "[WorkerManager] Cannot start Slack notice worker: SLACK_BOT_TOKEN or SLACK_NOTICE_CHANNEL_ID not set",
    );
    return null;
  }

  return startWorker("slackNotice", "workers/ingestion/slackNotice.worker.js");
}

// 워커 프로세스 정보를 외부에서 접근할 수 있도록 export
module.exports = {
  getWorkerProcesses: () => workerProcesses,
  startWorker,
  startSlackNoticeWorker,
};

// 서버 시작
startServer();
