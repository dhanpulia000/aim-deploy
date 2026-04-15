/**
 * Issue Lock Routes
 * 이슈 잠금 API 라우트
 */

const express = require('express');
const router = express.Router();
const issueLockController = require('../controllers/issueLock.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// 모든 라우트에 인증 필요
router.use(authenticate);

// 이슈 잠금 획득
router.post('/:issueId', issueLockController.acquireLock);

// 이슈 잠금 해제
router.delete('/:issueId', issueLockController.releaseLock);

// 이슈 잠금 상태 확인
router.get('/:issueId', issueLockController.checkLock);

// 잠금 활동 시간 갱신 (heartbeat)
router.put('/:issueId/refresh', issueLockController.refreshLock);

// 사용자의 모든 잠금 해제
router.delete('/user/:userId', issueLockController.releaseAllUserLocks);

module.exports = router;

