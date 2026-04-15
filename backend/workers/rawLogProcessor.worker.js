/**
 * RawLog → Issue 승격 워커 (SQLite 락 메커니즘 적용)
 * 
 * RawLog 테이블에서 처리 대기 중인 항목을 찾아서
 * ReportItemIssue로 변환하는 워커입니다.
 * 
 * - SQLite 락 메커니즘으로 중복 처리/무한 반복 방지
 * - 건별 에러 격리로 한 건 실패가 전체 파이프라인을 멈추지 않게 함
 * - 재시도 로직 (exponential backoff, 최대 5회)
 * - AI 분류 실패해도 Issue 생성 (fallback)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { query, queryOne, execute } = require('../libs/db');
const { nanoid } = require('nanoid');
const logger = require('../utils/logger');
const {
  upsertIssueFromNaverCafe,
  DISCOURSE_INZOI_ISSUE_INTEGRATION
} = require('../services/naverCafeIssues.service');
const { formatInstantAsKstWallClock } = require('../utils/dateUtils');

/**
 * Discourse 목록/토픽 API에서 넣은 메타를 이슈 본문 상단에 표시용 텍스트로 변환
 */
function discourseForumMetaPreamble(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  const hasExtra =
    metadata.url ||
    (metadata.discourseTags && metadata.discourseTags.length) ||
    metadata.discourseViews != null ||
    metadata.discourseLikeCount != null ||
    metadata.discourseReplyCount != null ||
    metadata.discourseImageUrl ||
    metadata.discourseCategoryName ||
    metadata.discourseLastPostedAt ||
    metadata.discourseTopicCreatedAt ||
    metadata.discourseExcerpt;
  if (!hasExtra) return '';

  const lines = ['─── Discourse (inZOI Forums) ───'];
  if (metadata.discourseCategoryName) {
    lines.push(`카테고리: ${metadata.discourseCategoryName}`);
  }
  if (metadata.discourseTags?.length) {
    lines.push(`태그: ${metadata.discourseTags.join(', ')}`);
  }
  const statParts = [];
  if (metadata.discourseViews != null) statParts.push(`조회 ${metadata.discourseViews}`);
  if (metadata.discourseLikeCount != null) statParts.push(`좋아요 ${metadata.discourseLikeCount}`);
  if (metadata.discourseReplyCount != null) statParts.push(`답글 ${metadata.discourseReplyCount}`);
  if (statParts.length) lines.push(statParts.join(' · '));
  if (metadata.discourseImageUrl) {
    lines.push(`대표 이미지: ${metadata.discourseImageUrl}`);
  }
  if (metadata.discourseTopicCreatedAt) {
    lines.push(`토픽 개설: ${formatInstantAsKstWallClock(metadata.discourseTopicCreatedAt)}`);
  }
  if (metadata.discourseLastPostedAt) {
    lines.push(`마지막 활동: ${formatInstantAsKstWallClock(metadata.discourseLastPostedAt)}`);
  }
  if (metadata.discourseExcerpt) {
    lines.push(`요약: ${metadata.discourseExcerpt}`);
  }
  if (metadata.url) {
    lines.push(`원문: ${metadata.url}`);
  }
  lines.push('─────────────────────────────', '');
  return `${lines.join('\n')}\n`;
}

function safeIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

// RawLog 처리 주기 (시스템 부하 고려하여 10초로 조정)
const PROCESS_INTERVAL_MS = 10000;

// 배치 크기 (한 번에 처리할 최대 RawLog 수, 시스템 부하 고려하여 100으로 조정)
const BATCH_SIZE = 100;

// 락 타임아웃 (3분 - 약간 여유를 두어 불필요한 타임아웃 감소)
const LOCK_TIMEOUT_MINUTES = 3;

// 최대 재시도 횟수
const MAX_ATTEMPTS = 5;

/**
 * SQLite 락 메커니즘: 후보 RawLog 1건 선점
 * @returns {string|null} 선점 성공한 RawLog ID 또는 null
 */
function acquireLock() {
  try {
    // 현재 시간 계산 (JavaScript Date 객체 사용)
    const now = new Date();
    const nowISO = now.toISOString();
    const timeoutThreshold = new Date(now.getTime() - LOCK_TIMEOUT_MINUTES * 60 * 1000);
    const timeoutThresholdISO = timeoutThreshold.toISOString();
    
    // 1) 후보 1건 선택 (타임아웃된 PROCESSING 상태도 포함)
    // nextRetryAt이 NULL이거나 현재 시간 이하인 경우 선택
    const candidate = queryOne(
      `SELECT id FROM RawLog
       WHERE isProcessed = 0
         AND (
           processingStatus = 'NEW' 
           OR processingStatus = 'PENDING'
           OR (
             processingStatus = 'ERROR' 
             AND (nextRetryAt IS NULL OR nextRetryAt <= ?)
             AND attempts < ?
           )
           OR (
             processingStatus = 'PROCESSING'
             AND (lockedAt IS NULL OR lockedAt <= ?)
           )
         )
         AND (lockedAt IS NULL OR lockedAt <= ?)
       ORDER BY createdAt ASC
       LIMIT 1`,
      [nowISO, MAX_ATTEMPTS, timeoutThresholdISO, timeoutThresholdISO]
    );

    if (!candidate) {
      return null;
    }

    // 2) 즉시 선점 UPDATE (원자적 연산)
    const lockNow = now.toISOString();
    const result = execute(
      `UPDATE RawLog
       SET processingStatus = 'PROCESSING',
           lockedAt = ?,
           updatedAt = ?
       WHERE id = ? 
         AND (
           processingStatus = 'NEW' 
           OR processingStatus = 'PENDING'
           OR processingStatus = 'ERROR'
         )
         AND (lockedAt IS NULL OR lockedAt <= ?)`,
      [lockNow, lockNow, candidate.id, timeoutThresholdISO]
    );

    // execute는 { changes, lastInsertRowid } 객체를 반환
    // changes가 1이면 선점 성공, 0이면 다른 프로세스가 먼저 잡았음
    if (result.changes === 1) {
      return candidate.id;
    }

    // 다른 프로세스가 먼저 잡았음
    return null;
  } catch (error) {
    logger.error('[RawLogProcessor] Failed to acquire lock', {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * RawLog를 Issue로 변환 (건별 에러 격리)
 * @param {string} rawLogId - RawLog ID
 * @returns {Promise<boolean>} 처리 성공 여부
 */
async function processRawLog(rawLogId) {
  let rawLog = null;
  let lockAcquired = false;
  
  try {
    // RawLog 조회
    rawLog = queryOne('SELECT * FROM RawLog WHERE id = ?', [rawLogId]);
    
    if (rawLog && rawLog.processingStatus === 'PROCESSING') {
      lockAcquired = true;
    }
    
    if (!rawLog) {
      logger.warn('[RawLogProcessor] RawLog not found', { rawLogId });
      return false;
    }

    // metadata 파싱
    let metadata = {};
    if (rawLog.metadata) {
      try {
        metadata = JSON.parse(rawLog.metadata);
      } catch (e) {
        logger.warn('[RawLogProcessor] Failed to parse metadata', { 
          rawLogId: rawLog.id,
          error: e.message 
        });
      }
    }

    // 소스별 처리
    if (rawLog.source === 'naver') {
      // Naver Cafe RawLog 처리
      const url = metadata.url || '';
      const cafeGame = metadata.cafeGame || 'PUBG_PC';
      const externalPostId = metadata.externalPostId || '';
      const monitoredBoardId = metadata.monitoredBoardId || null;

      // 게시글 데이터 구성
      let title = metadata.title || '';
      let content = rawLog.content || '';
      
      // 댓글 정보 추출
      const commentCount = metadata.commentCount || 0;
      const scrapedComments = metadata.scrapedComments || null;
      const isHotTopic = metadata.isHotTopic || false;
      const requiresLogin = metadata.requiresLogin === true || metadata.requiresLogin === 'true' || metadata.requiresLogin === 1;
      const hasKeywordMatch = metadata.hasKeywordMatch === true || metadata.hasKeywordMatch === 'true' || metadata.hasKeywordMatch === 1;
      
      logger.info('[RawLogProcessor] Processing RawLog', {
        rawLogId: rawLog.id,
        commentCount,
        hasScrapedComments: !!scrapedComments,
        isHotTopic,
        requiresLogin,
        title: title || '(no title)',
        contentLength: content?.length || 0
      });
      
      // 로그인 필요 게시글은 본문을 비워둠 (제목을 본문으로 사용하지 않음)
      // 제목과 본문이 같아지는 문제 방지
      if (requiresLogin && (!content || content.trim().length === 0)) {
        content = '';
        logger.info('[RawLogProcessor] Login-required post, keeping content empty', {
          rawLogId: rawLog.id,
          title: title || '(no title)'
        });
      }
      
      // 제목과 본문이 모두 비어있는 경우에만 스킵 (제목만 있어도 이슈로 생성)
      if ((!title || title.trim().length === 0) && (!content || content.trim().length === 0) && !requiresLogin) {
        logger.warn('[RawLogProcessor] Skipping RawLog with empty title and content (non login-required)', {
          rawLogId: rawLog.id,
          title: title || '(no title)',
          contentLength: content?.length || 0,
          requiresLogin
        });
        
        // 처리 완료로 표시 (스킵)
        const now = new Date().toISOString();
        execute(
          `UPDATE RawLog 
           SET isProcessed = ?, 
               processingStatus = 'DONE',
               lockedAt = NULL,
               lastError = NULL,
               updatedAt = ? 
           WHERE id = ?`,
          [1, now, rawLog.id]
        );
        
        return true; // 스킵은 성공으로 간주
      }
      
      // timestamp가 문자열일 수 있으므로 Date 객체로 안전 변환
      const timestamp = rawLog.timestamp instanceof Date
        ? rawLog.timestamp
        : new Date(rawLog.timestamp || Date.now());
      
      const post = {
        title: title || '제목 없음',
        content: content,
        author: rawLog.author || null,
        date: timestamp.toISOString(),
        createdAt: timestamp,
        externalPostId: externalPostId
      };

      // metadata에서 screenshotPath, hasImages, postImagePaths 추출
      const screenshotPath = metadata.screenshotPath || null;
      const hasImages = metadata.hasImages || false;
      let postImagePaths = metadata.postImagePaths;
      if (typeof postImagePaths === 'string') {
        try {
          postImagePaths = JSON.parse(postImagePaths);
        } catch {
          postImagePaths = null;
        }
      }
      if (!Array.isArray(postImagePaths) || postImagePaths.length === 0) {
        postImagePaths = null;
      }

      // Issue로 승격 (크리티컬: 모든 예외 처리하여 프로세스 중단 방지)
      try {
        await upsertIssueFromNaverCafe({
          url,
          cafeGame,
          post,
          comments: [],
          monitoredUrlId: null,
          monitoredBoardId: monitoredBoardId ? parseInt(monitoredBoardId) : null,
          screenshotPath: screenshotPath,
          postImagePaths: postImagePaths || undefined,
          hasImages: hasImages,
          requiresLogin: requiresLogin,
          commentCount: commentCount,
          scrapedComments: scrapedComments,
          isHotTopic: isHotTopic,
          hasKeywordMatch: hasKeywordMatch,
          naverCollection: metadata.naverCollection === 'clan' ? 'clan' : undefined
        });

        logger.info('[RawLogProcessor] Promoted RawLog to Issue', {
          rawLogId: rawLog.id,
          source: rawLog.source,
          url
        });

        // 처리 성공: DONE 상태로 업데이트
        const now = new Date().toISOString();
        execute(
          `UPDATE RawLog 
           SET isProcessed = ?, 
               processingStatus = 'DONE',
               lockedAt = NULL,
               lastError = NULL,
               attempts = 0,
               updatedAt = ? 
           WHERE id = ?`,
          [1, now, rawLog.id]
        );

        return true;
      } catch (issueError) {
        // 이슈 승격 실패 시 에러 로깅 및 재시도 가능하도록 설정
        logger.error('[RawLogProcessor] Failed to promote RawLog to Issue (CRITICAL)', {
          rawLogId: rawLog.id,
          source: rawLog.source,
          url,
          error: issueError.message,
          stack: issueError.stack
        });

        // 에러 정보 저장 (재시도 가능하도록)
        const errorNow = new Date().toISOString();
        const newAttempts = (rawLog.attempts || 0) + 1;
        const maxAttempts = 5; // 최대 5회 시도

        // 재시도 로직: exponential backoff
        const retryDelayMs = 60 * 1000 * Math.pow(2, newAttempts - 1); // 60초, 120초, 240초, 480초, 960초
        const nextRetryAt = newAttempts < maxAttempts 
          ? new Date(Date.now() + retryDelayMs).toISOString() 
          : null;
        
        execute(
          `UPDATE RawLog 
           SET processingStatus = ?,
               lastError = ?,
               attempts = ?,
               lockedAt = NULL,
               updatedAt = ?,
               nextRetryAt = ?
           WHERE id = ?`,
          [
            newAttempts >= maxAttempts ? 'FAILED' : 'ERROR',
            `이슈 승격 실패: ${issueError.message}`.substring(0, 500),
            newAttempts,
            errorNow,
            nextRetryAt,
            rawLog.id
          ]
        );

        // 최대 시도 횟수 초과 시에만 완전 실패로 처리
        if (newAttempts >= maxAttempts) {
          logger.error('[RawLogProcessor] RawLog processing failed after max attempts', {
            rawLogId: rawLog.id,
            attempts: newAttempts
          });
        }

        return false; // 실패 반환
      }

    } else if (rawLog.source === 'discourse') {
      const url = metadata.url || '';
      const title = metadata.title || '';
      const metaBlock = discourseForumMetaPreamble(metadata);
      let content = (metaBlock || '') + (rawLog.content || '');
      const externalPostId =
        metadata.externalPostId != null && metadata.externalPostId !== ''
          ? String(metadata.externalPostId)
          : rawLog.articleId
            ? String(rawLog.articleId)
            : '';
      const commentCount = metadata.commentCount || 0;
      const scrapedComments = metadata.scrapedComments || null;
      const isHotTopic = metadata.isHotTopic || false;
      const hasKeywordMatch =
        metadata.hasKeywordMatch === true ||
        metadata.hasKeywordMatch === 'true' ||
        metadata.hasKeywordMatch === 1;

      if (
        (!title || title.trim().length === 0) &&
        (!content || content.trim().length === 0)
      ) {
        logger.warn('[RawLogProcessor] Skipping Discourse RawLog with empty title and content', {
          rawLogId: rawLog.id,
          url
        });
        const nowSkip = new Date().toISOString();
        execute(
          `UPDATE RawLog 
           SET isProcessed = ?, 
               processingStatus = 'DONE',
               lockedAt = NULL,
               lastError = NULL,
               updatedAt = ? 
           WHERE id = ?`,
          [1, nowSkip, rawLog.id]
        );
        return true;
      }

      const timestamp =
        rawLog.timestamp instanceof Date
          ? rawLog.timestamp
          : new Date(rawLog.timestamp || Date.now());

      const post = {
        title: title || '제목 없음',
        content,
        author: rawLog.author || null,
        date: timestamp.toISOString(),
        createdAt: timestamp,
        externalPostId: externalPostId || String(rawLog.id)
      };

      let discoursePostImagePaths = metadata.postImagePaths;
      if (typeof discoursePostImagePaths === 'string') {
        try {
          discoursePostImagePaths = JSON.parse(discoursePostImagePaths);
        } catch {
          discoursePostImagePaths = null;
        }
      }
      if (!Array.isArray(discoursePostImagePaths) || discoursePostImagePaths.length === 0) {
        discoursePostImagePaths = null;
      }

      try {
        await upsertIssueFromNaverCafe({
          url,
          cafeGame: 'PUBG_PC',
          post,
          comments: [],
          monitoredUrlId: null,
          monitoredBoardId: null,
          screenshotPath: metadata.screenshotPath || null,
          postImagePaths: discoursePostImagePaths || undefined,
          hasImages: metadata.hasImages || false,
          requiresLogin: false,
          commentCount,
          scrapedComments,
          isHotTopic,
          hasKeywordMatch,
          issueIntegration: DISCOURSE_INZOI_ISSUE_INTEGRATION,
          discourseViews: safeIntOrNull(metadata.discourseViews),
          discourseLikeCount: safeIntOrNull(metadata.discourseLikeCount),
          discourseReplyCount: safeIntOrNull(metadata.discourseReplyCount)
        });

        logger.info('[RawLogProcessor] Promoted Discourse RawLog to Issue', {
          rawLogId: rawLog.id,
          url
        });

        const nowDone = new Date().toISOString();
        execute(
          `UPDATE RawLog 
           SET isProcessed = ?, 
               processingStatus = 'DONE',
               lockedAt = NULL,
               lastError = NULL,
               attempts = 0,
               updatedAt = ? 
           WHERE id = ?`,
          [1, nowDone, rawLog.id]
        );

        return true;
      } catch (issueError) {
        logger.error('[RawLogProcessor] Failed to promote Discourse RawLog to Issue', {
          rawLogId: rawLog.id,
          url,
          error: issueError.message,
          stack: issueError.stack
        });

        const errorNow = new Date().toISOString();
        const newAttempts = (rawLog.attempts || 0) + 1;
        const maxAttempts = 5;
        const retryDelayMs = 60 * 1000 * Math.pow(2, newAttempts - 1);
        const nextRetryAt =
          newAttempts < maxAttempts
            ? new Date(Date.now() + retryDelayMs).toISOString()
            : null;

        execute(
          `UPDATE RawLog 
           SET processingStatus = ?,
               lastError = ?,
               attempts = ?,
               lockedAt = NULL,
               updatedAt = ?,
               nextRetryAt = ?
           WHERE id = ?`,
          [
            newAttempts >= maxAttempts ? 'FAILED' : 'ERROR',
            `이슈 승격 실패: ${issueError.message}`.substring(0, 500),
            newAttempts,
            errorNow,
            nextRetryAt,
            rawLog.id
          ]
        );

        if (newAttempts >= maxAttempts) {
          logger.error('[RawLogProcessor] Discourse RawLog failed after max attempts', {
            rawLogId: rawLog.id,
            attempts: newAttempts
          });
        }

        return false;
      }

    } else if (rawLog.source === 'discord') {
      // Discord RawLog 처리
      let systemAgent = queryOne('SELECT * FROM Agent WHERE id = ?', ['system']);

      if (!systemAgent) {
        const now = new Date().toISOString();
        execute(
          'INSERT INTO Agent (id, name, status, handling, todayResolved, avgHandleSec, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ['system', 'System', 'offline', 0, 0, 0, 1, now, now]
        );
        systemAgent = queryOne('SELECT * FROM Agent WHERE id = ?', ['system']);
        logger.info('[RawLogProcessor] Created system agent', { id: systemAgent.id });
      }

      // 시스템 Report 찾기 또는 생성
      let systemReport = queryOne(
        'SELECT * FROM Report WHERE agentId = ? AND reportType = ?',
        ['system', 'discord_monitor']
      );

      if (!systemReport) {
        const reportDate = new Date().toISOString().split('T')[0];
        const reportId = nanoid();
        const now = new Date().toISOString();
        execute(
          'INSERT INTO Report (id, agentId, date, fileType, fileName, reportType, status, uploadedAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [reportId, 'system', reportDate, 'discord', 'discord_monitor', 'discord_monitor', 'processed', now, now, now]
        );
        systemReport = queryOne('SELECT * FROM Report WHERE id = ?', [reportId]);
        logger.info('[RawLogProcessor] Created system report', { id: systemReport.id });
      }

      // Issue 생성
      const timestamp = rawLog.timestamp instanceof Date
        ? rawLog.timestamp
        : new Date(rawLog.timestamp || Date.now());
      const issueDate = timestamp.toISOString().split('T')[0];
      const issueTime = timestamp.toISOString().split('T')[1]?.split('.')[0] || '';
      const issueId = nanoid();
      const now = new Date().toISOString();

      execute(
        `INSERT INTO ReportItemIssue (id, reportId, date, sourceCreatedAt, time, summary, detail, source, status, sentiment, severity, link, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          issueId,
          systemReport.id,
          issueDate,
          timestamp.toISOString(),
          issueTime,
          rawLog.content ? rawLog.content.substring(0, 200) : '',
          rawLog.content || '',
          'discord',
          'OPEN',
          'neu',
          3,
          metadata.url || null,
          now,
          now
        ]
      );

      logger.info('[RawLogProcessor] Promoted Discord RawLog to Issue', {
        rawLogId: rawLog.id,
        issueId: issueId
      });

      // 처리 성공
      const now2 = new Date().toISOString();
      execute(
        `UPDATE RawLog 
         SET isProcessed = ?, 
             processingStatus = 'DONE',
             lockedAt = NULL,
             lastError = NULL,
             attempts = 0,
             updatedAt = ? 
         WHERE id = ?`,
        [1, now2, rawLog.id]
      );

      return true;

    } else {
      // 기타 소스는 기본 처리
      logger.warn('[RawLogProcessor] Unknown source type', {
        rawLogId: rawLog.id,
        source: rawLog.source
      });

      // 알 수 없는 소스는 스킵 (DONE 처리)
      const now = new Date().toISOString();
      execute(
        `UPDATE RawLog 
         SET isProcessed = ?, 
             processingStatus = 'DONE',
             lockedAt = NULL,
             lastError = NULL,
             updatedAt = ? 
         WHERE id = ?`,
        [1, now, rawLog.id]
      );

      return true;
    }

  } catch (error) {
    // 건별 에러 격리: 이 RawLog만 ERROR 상태로 표시하고 다음 건 계속 처리
    logger.error('[RawLogProcessor] Failed to process RawLog', {
      rawLogId: rawLogId,
      error: error.message,
      stack: error.stack
    });

    // 재시도 로직 (exponential backoff)
    const currentAttempts = (rawLog?.attempts || 0) + 1;
    const shouldRetry = currentAttempts < MAX_ATTEMPTS;
    
    const now = new Date().toISOString();
    let nextRetryAt = null;
    
    if (shouldRetry) {
      // exponential backoff: 60초 * 2^(attempts)
      const delaySeconds = 60 * Math.pow(2, currentAttempts - 1);
      const retryDate = new Date(Date.now() + delaySeconds * 1000);
      nextRetryAt = retryDate.toISOString();
    }

    // ERROR 상태로 업데이트 (무조건 실행 보장)
    try {
      execute(
        `UPDATE RawLog 
         SET processingStatus = ?,
             attempts = ?,
             lastError = ?,
             nextRetryAt = ?,
             lockedAt = NULL,
             updatedAt = ? 
         WHERE id = ?`,
        [
          shouldRetry ? 'ERROR' : 'FAILED', // 최대 재시도 초과 시 FAILED로 마무리
          currentAttempts,
          (error.stack || error.message || 'Unknown error').substring(0, 500),
          nextRetryAt,
          now,
          rawLogId
        ]
      );
    } catch (updateError) {
      logger.error('[RawLogProcessor] Failed to update RawLog status after error', {
        rawLogId: rawLogId,
        updateError: updateError.message
      });
    }

    return false; // 실패
  } finally {
    // 락이 걸려있는데 상태 업데이트가 안 된 경우를 대비한 안전장치
    if (lockAcquired && rawLog) {
      try {
        const currentStatus = queryOne('SELECT processingStatus FROM RawLog WHERE id = ?', [rawLogId]);
        // PROCESSING 상태로 남아있으면 강제로 ERROR로 변경
        if (currentStatus && currentStatus.processingStatus === 'PROCESSING') {
          const now = new Date().toISOString();
          const currentAttempts = (rawLog.attempts || 0) + 1;
          const shouldRetry = currentAttempts < MAX_ATTEMPTS;
          let nextRetryAt = null;
          
          if (shouldRetry) {
            const delaySeconds = 60 * Math.pow(2, currentAttempts - 1);
            const retryDate = new Date(Date.now() + delaySeconds * 1000);
            nextRetryAt = retryDate.toISOString();
          }
          
          execute(
            `UPDATE RawLog 
             SET processingStatus = ?,
                 attempts = ?,
                 lastError = 'Processing failed - status not updated',
                 nextRetryAt = ?,
                 lockedAt = NULL,
                 updatedAt = ? 
             WHERE id = ? AND processingStatus = 'PROCESSING'`,
            [
              shouldRetry ? 'ERROR' : 'FAILED',
              currentAttempts,
              nextRetryAt,
              now,
              rawLogId
            ]
          );
          
          logger.warn('[RawLogProcessor] Force-unlocked stuck PROCESSING RawLog', {
            rawLogId: rawLogId
          });
        }
      } catch (finallyError) {
        logger.error('[RawLogProcessor] Error in finally block', {
          rawLogId: rawLogId,
          error: finallyError.message
        });
      }
    }
  }
}

/**
 * 타임아웃된 PROCESSING 상태 RawLog 정리 (10분 이상 잠금된 것들)
 */
function cleanupStuckProcessingLogs() {
  try {
    // 현재 시간에서 10분 전 계산
    const now = new Date();
    const timeoutThreshold = new Date(now.getTime() - LOCK_TIMEOUT_MINUTES * 60 * 1000);
    const nextRetryAt = new Date(now.getTime() + 60 * 1000); // 1분 후 재시도
    
    // 타임아웃된 PROCESSING 상태 RawLog 조회
    const stuckLogs = query(
      `SELECT id, lockedAt FROM RawLog 
       WHERE isProcessed = 0 
         AND processingStatus = 'PROCESSING'
         AND lockedAt IS NOT NULL`
    );
    
    let cleanedCount = 0;
    for (const log of stuckLogs) {
      const lockedAt = new Date(log.lockedAt);
      if (lockedAt <= timeoutThreshold) {
        const result = execute(
          `UPDATE RawLog 
           SET processingStatus = 'ERROR',
               attempts = COALESCE(attempts, 0) + 1,
               lastError = 'Processing timeout - stuck in PROCESSING state',
               lockedAt = NULL,
               nextRetryAt = ?,
               updatedAt = ?
           WHERE id = ? AND processingStatus = 'PROCESSING'`,
          [nextRetryAt.toISOString(), now.toISOString(), log.id]
        );
        
        if (result.changes > 0) {
          cleanedCount++;
        }
      }
    }
    
    if (cleanedCount > 0) {
      logger.warn('[RawLogProcessor] Cleaned up stuck PROCESSING logs', {
        count: cleanedCount
      });
    }
  } catch (error) {
    logger.error('[RawLogProcessor] Failed to cleanup stuck logs', {
      error: error.message
    });
  }
}

/**
 * 미처리 RawLog 배치 처리 (SQLite 락 메커니즘 사용)
 */
async function processPendingRawLogs() {
  const stats = {
    processed: 0,
    failed: 0,
    skipped: 0,
    lockFailed: 0
  };

  try {
    // 타임아웃된 PROCESSING 상태 정리
    cleanupStuckProcessingLogs();
    
    // 처리 대기 중인 RawLog 개수 확인 (NEW, PENDING, ERROR 상태 포함)
    // PostgreSQL 호환: datetime('now')는 SQLite 전용이라 제거하고 ISO 시각을 바인딩한다.
    const pendingNowIso = new Date().toISOString();
    const pendingCount = queryOne(
      `SELECT COUNT(*) as count FROM RawLog 
       WHERE isProcessed = 0 
         AND (
           processingStatus = 'NEW' 
           OR processingStatus = 'PENDING'
           OR (processingStatus = 'ERROR' AND (nextRetryAt IS NULL OR nextRetryAt <= ?) AND attempts < ?)
         )`,
      [pendingNowIso, MAX_ATTEMPTS]
    );
    
    const pendingTotal = pendingCount?.count || 0;
    
    // 배치 크기만큼 반복하여 처리
    for (let i = 0; i < BATCH_SIZE; i++) {
      // SQLite 락 메커니즘으로 RawLog 1건 선점
      const rawLogId = acquireLock();
      
      if (!rawLogId) {
        // 더 이상 처리할 RawLog가 없거나 락 선점 실패
        break;
      }

      // 선점한 RawLog 처리 (건별 에러 격리)
      const success = await processRawLog(rawLogId);
      
      if (success) {
        stats.processed++;
      } else {
        stats.failed++;
      }
    }
    
    // 처리 대기 중인 항목이 있으면 항상 로그 출력
    if (pendingTotal > 0) {
      logger.info('[RawLogProcessor] Processing status', {
        pendingTotal,
        processed: stats.processed,
        failed: stats.failed,
        skipped: stats.skipped,
        lockFailed: stats.lockFailed
      });
    }

    // 통계 로깅 (처리할 항목이 없어도 주기적으로 로그 출력)
    if (stats.processed > 0 || stats.failed > 0 || stats.skipped > 0) {
      logger.info('[RawLogProcessor] Batch processing completed', {
        processed: stats.processed,
        failed: stats.failed,
        skipped: stats.skipped,
        lockFailed: stats.lockFailed
      });
    } else {
      // 처리할 항목이 없을 때도 주기적으로 로그 출력 (디버깅용, 1분마다)
      const now = Date.now();
      if (!process.lastLogTime || now - process.lastLogTime > 60000) {
        process.lastLogTime = now;
        logger.debug('[RawLogProcessor] No pending RawLogs to process', {
          timestamp: new Date().toISOString()
        });
      }
    }

  } catch (error) {
    logger.error('[RawLogProcessor] Error in processPendingRawLogs', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * 워커 시작
 */
async function start() {
  logger.info('[RawLogProcessor] Starting RawLog processor worker', {
    intervalMs: PROCESS_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
    lockTimeoutMinutes: LOCK_TIMEOUT_MINUTES
  });

  // 즉시 한 번 실행
  await processPendingRawLogs();

  // 주기적으로 실행 (재진입 방지: 이전 실행이 10초 이상 걸리면 겹치지 않도록 스킵)
  let isProcessing = false;
  const interval = setInterval(async () => {
    if (isProcessing) {
      logger.debug('[RawLogProcessor] Previous run still in progress, skipping');
      return;
    }
    isProcessing = true;
    try {
      await processPendingRawLogs();
    } finally {
      isProcessing = false;
    }
  }, PROCESS_INTERVAL_MS);

  // 미처리 예외 방지 (프로세스 예기치 않은 종료 완화)
  process.on('unhandledRejection', (reason) => {
    logger.error('[RawLogProcessor] Unhandled rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('[RawLogProcessor] Uncaught exception', { error: error.message, stack: error.stack });
    clearInterval(interval);
    process.exit(1);
  });

  // 종료 시 정리
  process.on('SIGTERM', () => {
    logger.info('[RawLogProcessor] Received SIGTERM, shutting down');
    clearInterval(interval);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('[RawLogProcessor] Received SIGINT, shutting down');
    clearInterval(interval);
    process.exit(0);
  });
}

// 워커 시작
if (require.main === module) {
  start().catch((error) => {
    logger.error('[RawLogProcessor] Fatal error', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

module.exports = {
  start,
  processPendingRawLogs,
  processRawLog
};
