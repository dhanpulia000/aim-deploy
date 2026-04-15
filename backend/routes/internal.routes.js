const express = require('express');
const router = express.Router();
const internalController = require('../controllers/internal.controller');

router.post(
  '/issue-comment-refreshed',
  internalController.requireInternalToken,
  internalController.postIssueCommentRefreshed
);

router.post(
  '/realtime/broadcast',
  internalController.requireInternalToken,
  internalController.postRealtimeBroadcast
);

module.exports = router;
