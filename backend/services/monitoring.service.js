/**
 * 모니터링 서비스
 */

const { query, queryOne, execute } = require("../libs/db");
const logger = require("../utils/logger");
const Database = require("better-sqlite3");
const path = require("path");

// server.js의 워커 시작 함수 (순환 참조 방지를 위해 동적 로드)
let serverModule = null;
function getServerModule() {
  if (!serverModule) {
    try {
      serverModule = require("../server");
    } catch (err) {
      logger.error("[MonitoringService] Failed to load server module", {
        error: err.message,
      });
    }
  }
  return serverModule;
}

/**
 * 워커 프로세스 상태 확인
 * @returns {Promise<Object>} 워커 상태
 */
// 전역 워커 프로세스 맵 (server.js와 공유)
// 순환 참조를 피하기 위해 별도 모듈로 관리
let globalWorkerProcesses = null;
const INZOI_STANDALONE_DB_PATH = process.env.INZOI_STANDALONE_DB_PATH
  ? path.resolve(process.env.INZOI_STANDALONE_DB_PATH)
  : path.resolve(__dirname, "../../integrations/data/inzoi.db");

function withInzoiStandaloneDb(readFn) {
  let db = null;
  try {
    db = new Database(INZOI_STANDALONE_DB_PATH, {
      readonly: true,
      fileMustExist: true,
    });
    return readFn(db);
  } catch (error) {
    if (String(error?.message || "").includes("no such table")) {
      return [];
    }
    logger.warn("[MonitoringService] Failed to read standalone inZOI DB", {
      dbPath: INZOI_STANDALONE_DB_PATH,
      error: error.message,
    });
    return [];
  } finally {
    if (db) {
      try {
        db.close();
      } catch (_) {
        // ignore close errors
      }
    }
  }
}

/**
 * 워커 프로세스 맵 설정 (server.js에서 호출)
 */
function setWorkerProcesses(processes) {
  globalWorkerProcesses = processes;
}

/**
 * 워커 프로세스 상태 확인
 * @returns {Promise<Object>} 워커 상태
 */
async function getWorkerStatus() {
  try {
    const processes = globalWorkerProcesses;

    // 프로세스가 살아있는지 확인
    const checkProcessAlive = (process) => {
      if (!process) return false;
      try {
        // 프로세스가 존재하고 종료되지 않았는지 확인
        return process.pid && process.exitCode === null && !process.killed;
      } catch {
        return false;
      }
    };

    const naverCafeInfo = processes?.get("naverCafe");
    const naverCafeClanInfo = processes?.get("naverCafeClan");
    const naverCafeBackfillInfo = processes?.get("naverCafeBackfill");
    const discordInfo = processes?.get("discord");
    const discourseInzoiInfo = processes?.get("discourseInzoi");
    const inzoiStandaloneInfo = processes?.get("inzoiStandalone");

    return {
      naverCafe: {
        status: checkProcessAlive(naverCafeInfo?.process)
          ? "running"
          : "stopped",
        pid: naverCafeInfo?.process?.pid || null,
        lastCheck: new Date().toISOString(),
      },
      naverCafeClan: {
        status: checkProcessAlive(naverCafeClanInfo?.process)
          ? "running"
          : "stopped",
        pid: naverCafeClanInfo?.process?.pid || null,
        lastCheck: new Date().toISOString(),
      },
      naverCafeBackfill: {
        status: checkProcessAlive(naverCafeBackfillInfo?.process)
          ? "running"
          : "stopped",
        pid: naverCafeBackfillInfo?.process?.pid || null,
        lastCheck: new Date().toISOString(),
      },
      discord: {
        status: checkProcessAlive(discordInfo?.process) ? "running" : "stopped",
        pid: discordInfo?.process?.pid || null,
        lastCheck: new Date().toISOString(),
      },
      discourseInzoi: {
        status: checkProcessAlive(discourseInzoiInfo?.process)
          ? "running"
          : "stopped",
        pid: discourseInzoiInfo?.process?.pid || null,
        lastCheck: new Date().toISOString(),
      },
      inzoiStandalone: {
        status: checkProcessAlive(inzoiStandaloneInfo?.process)
          ? "running"
          : "stopped",
        pid: inzoiStandaloneInfo?.process?.pid || null,
        lastCheck: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error("[MonitoringService] Failed to get worker status", {
      error: error.message,
    });
    return {
      naverCafe: {
        status: "unknown",
        pid: null,
        lastCheck: new Date().toISOString(),
      },
      naverCafeClan: {
        status: "unknown",
        pid: null,
        lastCheck: new Date().toISOString(),
      },
      naverCafeBackfill: {
        status: "unknown",
        pid: null,
        lastCheck: new Date().toISOString(),
      },
      discord: {
        status: "unknown",
        pid: null,
        lastCheck: new Date().toISOString(),
      },
      discourseInzoi: {
        status: "unknown",
        pid: null,
        lastCheck: new Date().toISOString(),
      },
      inzoiStandalone: {
        status: "unknown",
        pid: null,
        lastCheck: new Date().toISOString(),
      },
    };
  }
}

async function getInzoiStandaloneTriggerAlerts(options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500);
  return withInzoiStandaloneDb((db) => {
    const stmt = db.prepare(`
      SELECT
        topic_title AS topic,
        author_username AS author,
        post_number AS postNumber,
        keywords,
        message,
        link,
        alert_time AS time
      FROM trigger_word_alerts
      ORDER BY datetime(alert_time) DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  });
}

async function getInzoiStandaloneDuplicateAlerts(options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 100, 1), 500);
  return withInzoiStandaloneDb((db) => {
    const stmt = db.prepare(`
      SELECT
        new_topic_title AS newTopic,
        new_topic_link AS newTopicLink,
        original_topic_title AS originalTopic,
        original_topic_link AS originalTopicLink,
        match_type AS matchType,
        similarity,
        alert_time AS time
      FROM duplicate_topic_alert_events
      ORDER BY datetime(alert_time) DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  });
}

/**
 * 모니터링 키워드 목록 조회
 * @param {Object} options - 쿼리 옵션
 * @returns {Promise<Array>} 키워드 목록
 */
async function getKeywords(options = {}) {
  const { type, enabled } = options;

  let sql = "SELECT * FROM MonitoringKeyword WHERE 1=1";
  const params = [];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  if (enabled !== undefined) {
    sql += " AND enabled = ?";
    params.push(enabled ? 1 : 0);
  }

  sql += " ORDER BY createdAt DESC";

  return query(sql, params);
}

/**
 * 모니터링 키워드 생성
 * @param {Object} data - 키워드 데이터
 * @returns {Promise<Object>} 생성된 키워드
 */
async function createKeyword(data) {
  const { type, word, enabled = true } = data;

  if (!type || !word) {
    throw new Error("type and word are required");
  }

  const now = new Date().toISOString();
  const result = execute(
    "INSERT INTO MonitoringKeyword (type, word, enabled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    [type, word.trim(), enabled ? 1 : 0, now, now],
  );

  return queryOne("SELECT * FROM MonitoringKeyword WHERE id = ?", [
    result.lastInsertRowid,
  ]);
}

/**
 * 모니터링 키워드 삭제
 * @param {number} id - 키워드 ID
 * @returns {Promise<Object>} 삭제된 키워드
 */
async function deleteKeyword(id) {
  const keyword = queryOne("SELECT * FROM MonitoringKeyword WHERE id = ?", [
    id,
  ]);
  if (!keyword) {
    throw new Error("Keyword not found");
  }

  execute("DELETE FROM MonitoringKeyword WHERE id = ?", [id]);
  return keyword;
}

/**
 * 최근 수집 로그 조회
 * @param {Object} options - 쿼리 옵션
 * @returns {Promise<Object>} 로그 목록 및 페이지네이션
 */
async function getRecentLogs(options = {}) {
  const { source, isProcessed, limit = 100, offset = 0, startDate } = options;

  // RawLog와 MonitoredBoard, Project를 조인하여 프로젝트명 가져오기
  let sql = `
    SELECT 
      rl.*,
      p.name as projectName,
      p.id as projectId
    FROM RawLog rl
    LEFT JOIN MonitoredBoard mb ON rl.boardId = mb.id
    LEFT JOIN Project p ON mb.projectId = p.id
    WHERE 1=1
  `;
  const params = [];

  if (source) {
    sql += " AND rl.source = ?";
    params.push(source);
  }
  if (isProcessed !== undefined) {
    sql += " AND rl.isProcessed = ?";
    params.push(isProcessed ? 1 : 0);
  }
  if (startDate) {
    // startDate는 YYYY-MM-DD 형식, createdAt은 ISO 형식
    // KST 기준 날짜 필터
    sql += " AND DATE(rl.createdAt, '+9 hours') >= DATE(?)";
    params.push(startDate);
  }

  sql += " ORDER BY rl.createdAt DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const logs = query(sql, params).map((log) => ({
    ...log,
    isProcessed: Boolean(log.isProcessed),
    projectName: log.projectName || null,
    projectId: log.projectId || null,
  }));

  // 전체 개수 조회
  let countSql = "SELECT COUNT(*) as count FROM RawLog WHERE 1=1";
  const countParams = [];

  if (source) {
    countSql += " AND source = ?";
    countParams.push(source);
  }
  if (isProcessed !== undefined) {
    countSql += " AND isProcessed = ?";
    countParams.push(isProcessed ? 1 : 0);
  }
  if (startDate) {
    // KST 기준 날짜 필터
    countSql += " AND DATE(createdAt, '+9 hours') >= DATE(?)";
    countParams.push(startDate);
  }

  const totalResult = queryOne(countSql, countParams);
  const total = totalResult?.count || 0;

  return {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + logs.length < total,
  };
}

/**
 * 모니터링 설정 조회
 * @param {string} key - 설정 키
 * @returns {Promise<Object|null>} 설정 값
 */
async function getConfig(key) {
  return queryOne("SELECT * FROM MonitoringConfig WHERE key = ?", [key]);
}

/**
 * 모니터링 설정 저장/업데이트
 * @param {string} key - 설정 키
 * @param {string} value - 설정 값
 * @param {string} description - 설정 설명
 * @returns {Promise<Object>} 저장된 설정
 */
async function setConfig(key, value, description = null) {
  const existing = queryOne("SELECT * FROM MonitoringConfig WHERE key = ?", [
    key,
  ]);
  const now = new Date().toISOString();

  if (existing) {
    execute(
      "UPDATE MonitoringConfig SET value = ?, description = ?, updatedAt = ? WHERE key = ?",
      [value, description, now, key],
    );
  } else {
    execute(
      "INSERT INTO MonitoringConfig (key, value, description, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      [key, value, description, now, now],
    );
  }

  return queryOne("SELECT * FROM MonitoringConfig WHERE key = ?", [key]);
}

/**
 * 수동 크롤링 트리거 (데이터베이스 플래그 사용)
 * 워커가 주기적으로 체크하는 플래그를 설정하여 즉시 스캔을 트리거합니다.
 * @returns {Promise<Object>} 트리거 결과
 */
async function triggerManualScan() {
  try {
    const processes = globalWorkerProcesses;
    const naverCafeInfo = processes?.get("naverCafe");

    if (!naverCafeInfo || !naverCafeInfo.process) {
      throw new Error("Naver Cafe 워커가 실행 중이지 않습니다");
    }

    const process = naverCafeInfo.process;

    // 프로세스가 살아있는지 확인
    if (process.exitCode !== null || process.killed) {
      throw new Error("Naver Cafe 워커 프로세스가 종료되었습니다");
    }

    // 데이터베이스에 트리거 플래그 설정
    // 워커가 주기적으로 이 플래그를 체크하고 스캔을 실행합니다
    await setConfig(
      "manual_scan_trigger",
      Date.now().toString(),
      "수동 스캔 트리거 플래그 (워커가 체크)",
    );

    logger.info("[MonitoringService] Manual scan triggered", {
      pid: process.pid,
    });

    return {
      success: true,
      message: "수동 스캔이 트리거되었습니다. 워커가 곧 스캔을 시작합니다.",
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("[MonitoringService] Failed to trigger manual scan", {
      error: error.message,
    });
    throw error;
  }
}

/**
 * 수동 슬랙 공지 수집 트리거 (데이터베이스 플래그 사용)
 * 워커가 주기적으로 체크하는 플래그를 설정하여 즉시 수집을 트리거합니다.
 * 워커가 실행 중이 아니면 자동으로 워커를 시작합니다.
 * @returns {Promise<Object>} 트리거 결과
 */
async function triggerSlackNoticeCollection() {
  try {
    const processes = globalWorkerProcesses;
    const slackNoticeInfo = processes?.get("slackNotice");

    let workerRunning = false;
    let workerPid = null;
    let workerStarted = false;

    // 워커 프로세스 확인
    if (slackNoticeInfo && slackNoticeInfo.process) {
      const process = slackNoticeInfo.process;
      if (process.exitCode === null && !process.killed) {
        workerRunning = true;
        workerPid = process.pid;
      }
    }

    // 워커가 실행 중이 아니면 강제로 시작
    if (!workerRunning) {
      logger.info(
        "[MonitoringService] Slack notice worker not running, attempting to start...",
      );
      const serverModule = getServerModule();
      if (serverModule && serverModule.startSlackNoticeWorker) {
        try {
          const workerProcess = serverModule.startSlackNoticeWorker();
          if (workerProcess) {
            workerStarted = true;
            workerPid = workerProcess.pid;
            workerRunning = true;
            logger.info("[MonitoringService] Slack notice worker started", {
              pid: workerPid,
            });

            // 워커가 시작될 때까지 잠시 대기
            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else {
            logger.warn(
              "[MonitoringService] Failed to start Slack notice worker (configuration may be missing)",
            );
          }
        } catch (err) {
          logger.error(
            "[MonitoringService] Error starting Slack notice worker",
            { error: err.message },
          );
        }
      } else {
        logger.warn(
          "[MonitoringService] Cannot start Slack notice worker: server module not available",
        );
      }
    }

    // 데이터베이스에 트리거 플래그 설정
    // 워커가 주기적으로 이 플래그를 체크하고 수집을 실행합니다
    await setConfig(
      "manual_slack_notice_trigger",
      Date.now().toString(),
      "수동 슬랙 공지 수집 트리거 플래그 (워커가 체크)",
    );

    if (workerRunning) {
      const message = workerStarted
        ? "슬랙 공지 수집 워커를 시작했습니다. 곧 수집을 시작합니다."
        : "수동 슬랙 공지 수집이 트리거되었습니다. 워커가 곧 수집을 시작합니다.";

      logger.info(
        "[MonitoringService] Manual Slack notice collection triggered",
        {
          pid: workerPid,
          workerStarted,
        },
      );

      return {
        success: true,
        message,
        pid: workerPid,
        workerRunning: true,
        workerStarted,
        timestamp: new Date().toISOString(),
      };
    } else {
      logger.info(
        "[MonitoringService] Manual Slack notice collection trigger flag set (worker not running)",
        {
          note: "워커가 시작되면 플래그를 감지하고 수집을 실행합니다",
        },
      );
      return {
        success: true,
        message:
          "트리거 플래그가 설정되었습니다. 워커가 시작되면 자동으로 수집을 실행합니다.",
        workerRunning: false,
        workerStarted: false,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (error) {
    logger.error(
      "[MonitoringService] Failed to trigger Slack notice collection",
      { error: error.message },
    );
    throw error;
  }
}

module.exports = {
  setWorkerProcesses,
  getWorkerStatus,
  getKeywords,
  createKeyword,
  deleteKeyword,
  getRecentLogs,
  getConfig,
  setConfig,
  getInzoiStandaloneTriggerAlerts,
  getInzoiStandaloneDuplicateAlerts,
  triggerManualScan,
  triggerSlackNoticeCollection,
};
