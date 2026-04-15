const express = require('express');
const router = express.Router();
const agentStatsController = require('../controllers/agentStats.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// 모든 라우트에 인증 필요
router.use(authenticate);

// game-volume 은 routes/index.js 에서 /agent-stats 접두사로 직접 등록됨

// 에이전트 통계 조회
router.get('/', agentStatsController.getAgentStats);

// 엑셀 보고서 다운로드
router.get('/export', agentStatsController.exportStatsToExcel);

module.exports = router;



