// LINE routes (admin utilities)

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const lineTargetsController = require('../controllers/lineTargets.controller');
const lineUsageService = require('../services/lineUsage.service');
const { sendSuccess } = require('../utils/http');

/**
 * @route GET /api/line/targets
 * @desc LINE chat targets discovered via webhook (group/room/user)
 * @query {string} type - group|room|user (optional)
 * @access Admin
 */
router.get('/targets', authenticate, requireAdmin(), lineTargetsController.listTargets);

/**
 * @route PUT /api/line/targets/:id
 * @desc Update displayName (manual label)
 * @access Admin
 */
router.put('/targets/:id', authenticate, requireAdmin(), lineTargetsController.updateDisplayName);

/**
 * @route GET /api/line/usage
 * @desc LINE API 발송 건수 (앱 기준 집계). 공식 쿼터는 LINE Manager에서 확인
 * @access Admin
 */
router.get('/usage', authenticate, requireAdmin(), (req, res) => {
  const usage = lineUsageService.getUsage();
  sendSuccess(res, usage, 'Line usage retrieved');
});

module.exports = router;

