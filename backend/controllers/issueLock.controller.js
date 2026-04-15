/**
 * Issue Lock Controller
 * 이슈 잠금 API 엔드포인트
 */

const issueLockService = require('../services/issueLock.service');
const logger = require('../utils/logger');
const publisher = require('../realtime/publisher');

/**
 * 이슈 잠금 획득
 * POST /api/issue-locks/:issueId
 */
async function acquireLock(req, res) {
  try {
    const { issueId } = req.params;
    const userId = req.user.id;
    const userName = req.user.name || req.user.email;

    const result = issueLockService.acquireLock(issueId, userId, userName);

    if (result.success) {
      // WebSocket으로 브로드캐스트
      publisher.broadcast({
        type: 'issue_locked',
        payload: {
          issueId,
          lock: result.lock
        }
      });

      res.json({
        success: true,
        lock: result.lock
      });
    } else {
      res.status(409).json({
        success: false,
        message: `이슈가 이미 ${result.existingLock.userName}님에 의해 열려있습니다.`,
        existingLock: result.existingLock
      });
    }
  } catch (error) {
    logger.error('Failed to acquire lock', {
      issueId: req.params.issueId,
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: '잠금 획득에 실패했습니다.'
    });
  }
}

/**
 * 이슈 잠금 해제
 * DELETE /api/issue-locks/:issueId
 */
async function releaseLock(req, res) {
  try {
    const { issueId } = req.params;
    const userId = req.user.id;

    const released = issueLockService.releaseLock(issueId, userId);

    if (released) {
      // WebSocket으로 브로드캐스트
      publisher.broadcast({
        type: 'issue_unlocked',
        payload: {
          issueId,
          userId
        }
      });
    }

    res.json({
      success: true,
      released
    });
  } catch (error) {
    logger.error('Failed to release lock', {
      issueId: req.params.issueId,
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: '잠금 해제에 실패했습니다.'
    });
  }
}

/**
 * 이슈 잠금 상태 확인
 * GET /api/issue-locks/:issueId
 */
async function checkLock(req, res) {
  try {
    const { issueId } = req.params;

    const lock = issueLockService.checkLock(issueId);

    res.json({
      locked: !!lock,
      lock
    });
  } catch (error) {
    logger.error('Failed to check lock', {
      issueId: req.params.issueId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: '잠금 상태 확인에 실패했습니다.'
    });
  }
}

/**
 * 잠금 활동 시간 갱신 (heartbeat)
 * PUT /api/issue-locks/:issueId/refresh
 */
async function refreshLock(req, res) {
  try {
    const { issueId } = req.params;
    const userId = req.user.id;

    const refreshed = issueLockService.refreshLock(issueId, userId);

    res.json({
      success: true,
      refreshed
    });
  } catch (error) {
    logger.error('Failed to refresh lock', {
      issueId: req.params.issueId,
      userId: req.user?.id,
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: '잠금 갱신에 실패했습니다.'
    });
  }
}

/**
 * 사용자의 모든 잠금 해제
 * DELETE /api/issue-locks/user/:userId
 */
async function releaseAllUserLocks(req, res) {
  try {
    const { userId } = req.params;

    // 본인 또는 관리자만 가능
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '권한이 없습니다.'
      });
    }

    const count = issueLockService.releaseAllUserLocks(userId);

    if (count > 0) {
      // WebSocket으로 브로드캐스트
      publisher.broadcast({
        type: 'user_locks_released',
        payload: {
          userId
        }
      });
    }

    res.json({
      success: true,
      count
    });
  } catch (error) {
    logger.error('Failed to release all user locks', {
      userId: req.params.userId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      message: '잠금 해제에 실패했습니다.'
    });
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  checkLock,
  refreshLock,
  releaseAllUserLocks
};


