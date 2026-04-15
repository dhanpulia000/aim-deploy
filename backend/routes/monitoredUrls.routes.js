const express = require('express');
const router = express.Router();
const controller = require('../controllers/monitoredUrls.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

// 모든 엔드포인트는 Admin 전용
router.get('/', authenticate, requireAdmin(), controller.listMonitoredUrls);
router.post('/', authenticate, requireAdmin(), controller.createMonitoredUrl);
router.patch('/:id', authenticate, requireAdmin(), controller.updateMonitoredUrl);
router.delete('/:id', authenticate, requireAdmin(), controller.deleteMonitoredUrl);

module.exports = router;























