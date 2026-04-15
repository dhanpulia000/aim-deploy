// Weekly Reports 라우트

const express = require('express');
const router = express.Router();
const weeklyController = require('../controllers/weekly.controller');

/**
 * @route POST /api/weekly-reports/generate
 * @desc 주간 보고서 생성
 * @access Public
 */
router.post('/generate', weeklyController.generateWeeklyReport);

/**
 * @route GET /api/weekly-reports/:agentId
 * @desc 에이전트별 주간 보고서 목록 조회
 * @access Public
 */
router.get('/:agentId', weeklyController.getWeeklyReportsByAgent);

/**
 * @route GET /api/weekly-reports/:agentId/download/:reportId
 * @desc 주간 보고서 다운로드
 * @access Public
 */
router.get('/:agentId/download/:reportId', weeklyController.downloadWeeklyReport);

/**
 * @route DELETE /api/weekly-reports/:reportId
 * @desc 주간 보고서 삭제
 * @access Public
 */
router.delete('/:reportId', weeklyController.deleteWeeklyReport);

/**
 * @route GET /api/weekly-reports/:agentId/statistics
 * @desc 주간 보고서 통계 조회
 * @access Public
 */
router.get('/:agentId/statistics', weeklyController.getWeeklyReportStatistics);

module.exports = router;

