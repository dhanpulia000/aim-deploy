/**
 * 모니터링 크롤러(별도 프로세스)에서 실패를 반드시 남기기 위한 로깅.
 * catch 블록에서 조용히 카운트만 올리면 운영에서 "크롤러 멈춤" 대응이 불가능해짐.
 */
const logger = require('./logger');

const MAX_STACK = 6000;

function formatErrorParts(error) {
  const msg = error && typeof error === 'object' && 'message' in error ? error.message : String(error);
  const stack =
    error && typeof error === 'object' && typeof error.stack === 'string' ? error.stack : undefined;
  return {
    error: msg,
    ...(stack ? { stack: stack.length > MAX_STACK ? `${stack.slice(0, MAX_STACK)}…` : stack } : {})
  };
}

/**
 * @param {string} workerTag
 * @param {Record<string, unknown>} context - boardId, messageId 등 식별 필드
 * @param {unknown} error
 */
function logCrawlerFailure(workerTag, context, error) {
  logger.error(`[${workerTag}] Operation failed`, {
    ...context,
    ...formatErrorParts(error)
  });
}

/**
 * @param {string} workerTag
 * @param {object} board - { id, name?, label? }
 * @param {unknown} error
 */
function logBoardScanFailure(workerTag, board, error) {
  logCrawlerFailure(
    workerTag,
    {
      boardId: board && board.id,
      boardName: (board && (board.name || board.label)) || undefined
    },
    error
  );
}

/**
 * 한 사이클에서 성공 0·실패만 있으면 별도 경고(알림·로그 모니터링 훅용).
 */
function logScanCycleAllFailed(workerTag, { attempted, success, fail }) {
  if (attempted > 0 && success === 0 && fail > 0) {
    logger.error(`[${workerTag}] Crawl cycle: all board scans failed`, {
      attempted,
      success,
      fail
    });
  }
}

module.exports = { logCrawlerFailure, logBoardScanFailure, logScanCycleAllFailed };
