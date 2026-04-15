/**
 * 내부 API (워커 → 메인 프로세스 콜백)
 */

const issuesService = require('../services/issues.service');
const publisher = require('../realtime/publisher');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

function requireInternalToken(req, res, next) {
  const expected = process.env.ISSUE_WATCH_INTERNAL_TOKEN;
  if (!expected || String(expected).trim() === '') {
    logger.error('[Internal] ISSUE_WATCH_INTERNAL_TOKEN is not set');
    return sendError(res, 'Internal callback not configured', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  const header = req.get('X-Internal-Token');
  if (header !== expected) {
    return sendError(res, 'Unauthorized', HTTP_STATUS.UNAUTHORIZED);
  }
  next();
}

const postIssueCommentRefreshed = asyncMiddleware(async (req, res) => {
  const { issueId } = req.body || {};
  if (!issueId) {
    return sendValidationError(res, [{ field: 'issueId', message: 'issueId is required' }]);
  }

  const issue = await issuesService.getIssueDetailForClient(issueId, undefined);
  if (!issue) {
    return sendError(res, 'Issue not found', HTTP_STATUS.NOT_FOUND);
  }

  const commentCount = issue.commentsCount ?? issue.commentCount ?? 0;
  publisher.broadcastImmediate('issue_comments_updated', {
    issueId: issue.id,
    commentCount,
    projectId: issue.projectId != null ? issue.projectId : null
  });

  sendSuccess(res, { ok: true, issueId: issue.id }, 'Broadcasted');
});

/**
 * 워커/독립 프로세스 → 메인 프로세스 WebSocket 브로드캐스트
 * POST /api/internal/realtime/broadcast
 * Headers: X-Internal-Token
 * Body: { type: string, payload?: object }
 */
const postRealtimeBroadcast = asyncMiddleware(async (req, res) => {
  const { type, payload } = req.body || {};
  if (!type || typeof type !== 'string') {
    return sendValidationError(res, [{ field: 'type', message: 'type is required (string)' }]);
  }
  const pl = payload != null && typeof payload === 'object' ? payload : {};
  publisher.broadcastImmediate(type, pl);
  sendSuccess(res, { ok: true }, 'Broadcasted');
});

module.exports = {
  requireInternalToken,
  postIssueCommentRefreshed,
  postRealtimeBroadcast
};
