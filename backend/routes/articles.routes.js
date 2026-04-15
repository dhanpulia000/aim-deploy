// Articles 라우트

const express = require('express');
const router = express.Router();
const articlesController = require('../controllers/articles.controller');

/**
 * @route GET /api/articles/files
 * @desc 사용 가능한 스크래핑 데이터 파일 목록 조회
 * @access Public
 */
router.get('/files', articlesController.getArticleFiles);

/**
 * @route POST /api/articles/import
 * @desc 스크래핑된 커뮤니티 데이터를 이슈로 변환하여 저장
 * @body {string} fileName - 파일명
 * @body {string} agentId - 에이전트 ID (선택)
 * @access Public
 */
router.post('/import', articlesController.importArticles);

module.exports = router;







