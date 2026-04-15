/**
 * Realtime / WebSocket 브로드캐스트 라우트
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const realtimeController = require('../controllers/realtime.controller');

/**
 * POST /api/realtime/broadcast
 * 즉시 WebSocket 브로드캐스트
 * Body: { type: string, payload?: object }
 * @access Private (인증 필요)
 */
router.post('/broadcast', authenticate, realtimeController.broadcast);

module.exports = router;
