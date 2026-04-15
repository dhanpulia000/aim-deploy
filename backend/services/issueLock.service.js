/**
 * Issue Lock Service
 * 이슈 동시 접근 제어를 위한 잠금 관리
 */

const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');

const LOCK_TIMEOUT_MINUTES = 5; // 5분 후 자동 만료

/**
 * 이슈 잠금 획득
 * @param {string} issueId - 이슈 ID
 * @param {string} userId - 사용자 ID
 * @param {string} userName - 사용자 이름
 * @returns {Object} { success: boolean, lock?: object, existingLock?: object }
 */
function acquireLock(issueId, userId, userName) {
  try {
    // 기존 잠금 확인
    const existingLock = query(
      `SELECT il.*, u.name as userName 
       FROM IssueLock il
       LEFT JOIN User u ON il.userId = u.id
       WHERE il.issueId = ?`,
      [issueId]
    )[0];

    // 만료된 잠금은 삭제
    if (existingLock) {
      const now = new Date();
      const expiresAt = new Date(existingLock.expiresAt);
      
      if (now > expiresAt) {
        // 만료됨 - 삭제하고 새로 잠금
        execute('DELETE FROM IssueLock WHERE issueId = ?', [issueId]);
      } else if (existingLock.userId === userId) {
        // 같은 사용자 - 활동 시간 업데이트
        const newExpiresAt = new Date(Date.now() + LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
        execute(
          `UPDATE IssueLock 
           SET lastActivityAt = datetime('now'), expiresAt = ? 
           WHERE issueId = ?`,
          [newExpiresAt, issueId]
        );
        
        logger.debug('Lock refreshed for same user', { issueId, userId, userName });
        return { success: true, lock: { ...existingLock, expiresAt: newExpiresAt } };
      } else {
        // 다른 사용자가 잠금 중
        logger.info('Lock acquisition failed - already locked by another user', {
          issueId,
          requestedBy: userName,
          lockedBy: existingLock.userName
        });
        return { success: false, existingLock };
      }
    }

    // 새로운 잠금 생성
    const lockId = `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();

    execute(
      `INSERT INTO IssueLock (id, issueId, userId, userName, lockedAt, expiresAt, lastActivityAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [lockId, issueId, userId, userName, now, expiresAt, now]
    );

    const newLock = query('SELECT * FROM IssueLock WHERE id = ?', [lockId])[0];

    logger.info('Lock acquired successfully', { issueId, userId, userName, lockId });
    return { success: true, lock: newLock };
  } catch (error) {
    logger.error('Failed to acquire lock', {
      issueId,
      userId,
      error: error.message
    });
    throw error;
  }
}

/**
 * 이슈 잠금 해제
 * @param {string} issueId - 이슈 ID
 * @param {string} userId - 사용자 ID
 * @returns {boolean}
 */
function releaseLock(issueId, userId) {
  try {
    const result = execute(
      'DELETE FROM IssueLock WHERE issueId = ? AND userId = ?',
      [issueId, userId]
    );

    const released = result.changes > 0;
    
    if (released) {
      logger.info('Lock released successfully', { issueId, userId });
    } else {
      logger.debug('No lock to release', { issueId, userId });
    }

    return released;
  } catch (error) {
    logger.error('Failed to release lock', {
      issueId,
      userId,
      error: error.message
    });
    throw error;
  }
}

/**
 * 이슈 잠금 상태 확인
 * @param {string} issueId - 이슈 ID
 * @returns {Object|null}
 */
function checkLock(issueId) {
  try {
    const lock = query(
      `SELECT il.*, u.name as userName 
       FROM IssueLock il
       LEFT JOIN User u ON il.userId = u.id
       WHERE il.issueId = ?`,
      [issueId]
    )[0];

    if (!lock) {
      return null;
    }

    // 만료 체크
    const now = new Date();
    const expiresAt = new Date(lock.expiresAt);

    if (now > expiresAt) {
      // 만료된 잠금 삭제
      execute('DELETE FROM IssueLock WHERE issueId = ?', [issueId]);
      logger.debug('Expired lock removed', { issueId });
      return null;
    }

    return lock;
  } catch (error) {
    logger.error('Failed to check lock', {
      issueId,
      error: error.message
    });
    throw error;
  }
}

/**
 * 사용자의 모든 잠금 해제
 * @param {string} userId - 사용자 ID
 * @returns {number} 해제된 잠금 수
 */
function releaseAllUserLocks(userId) {
  try {
    const result = execute('DELETE FROM IssueLock WHERE userId = ?', [userId]);
    
    if (result.changes > 0) {
      logger.info('All user locks released', { userId, count: result.changes });
    }

    return result.changes;
  } catch (error) {
    logger.error('Failed to release all user locks', {
      userId,
      error: error.message
    });
    throw error;
  }
}

/**
 * 만료된 잠금 정리
 * @returns {number} 정리된 잠금 수
 */
function cleanupExpiredLocks() {
  try {
    const now = new Date().toISOString();
    const result = execute('DELETE FROM IssueLock WHERE expiresAt < ?', [now]);
    
    if (result.changes > 0) {
      logger.info('Expired locks cleaned up', { count: result.changes });
    }

    return result.changes;
  } catch (error) {
    logger.error('Failed to cleanup expired locks', {
      error: error.message
    });
    throw error;
  }
}

/**
 * 잠금 활동 시간 갱신 (heartbeat)
 * @param {string} issueId - 이슈 ID
 * @param {string} userId - 사용자 ID
 * @returns {boolean}
 */
function refreshLock(issueId, userId) {
  try {
    const newExpiresAt = new Date(Date.now() + LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
    
    const result = execute(
      `UPDATE IssueLock 
       SET lastActivityAt = datetime('now'), expiresAt = ? 
       WHERE issueId = ? AND userId = ?`,
      [newExpiresAt, issueId, userId]
    );

    const refreshed = result.changes > 0;
    
    if (refreshed) {
      logger.debug('Lock refreshed', { issueId, userId });
    }

    return refreshed;
  } catch (error) {
    logger.error('Failed to refresh lock', {
      issueId,
      userId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  acquireLock,
  releaseLock,
  checkLock,
  releaseAllUserLocks,
  cleanupExpiredLocks,
  refreshLock,
  LOCK_TIMEOUT_MINUTES
};


