const express = require('express');
const router = express.Router();
const controller = require('../controllers/monitoredBoards.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

// 모든 엔드포인트는 Admin 전용
router.get('/', authenticate, requireAdmin(), controller.listMonitoredBoards);
router.post('/', authenticate, requireAdmin(), controller.createMonitoredBoard);
router.patch('/:id', authenticate, requireAdmin(), controller.updateMonitoredBoard);
router.delete('/:id', authenticate, requireAdmin(), controller.deleteMonitoredBoard);

module.exports = router;























