/**
 * 수동 수집 라우트
 */

const express = require('express');
const router = express.Router();
const ingestionController = require('../controllers/ingestion.controller');

/**
 * @route POST /api/ingestion/manual
 * @desc URL을 통해 네이버 카페 게시글을 수동으로 수집
 * @body {string} url - 네이버 카페 게시글 URL
 * @access Private (인증 필요 시 추가)
 */
router.post('/manual', ingestionController.manualIngest);

module.exports = router;









