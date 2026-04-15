// YouTube 라우트
const express = require('express');
const router = express.Router();
const youtubeController = require('../controllers/youtube.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { createFileUploadMiddleware } = require('../services/files.service');

/**
 * @route POST /api/youtube/weekly-metadata
 * @desc 주간 영상 메타데이터 수집 및 CSV 생성
 * @body {string} apiKey - YouTube Data API v3 API 키
 * @body {string} channelId - 채널 ID
 * @body {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 * @access Private
 */
router.post('/weekly-metadata', authenticate, youtubeController.collectWeeklyMetadata);

/**
 * @route GET /api/youtube/weekly-period
 * @desc 주간 기간 정보 조회 (월요일 00:00 ~ 일요일 23:59)
 * @query {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 * @access Public
 */
router.get('/weekly-period', youtubeController.getWeeklyPeriod);

// 엑셀 파일 업로드 미들웨어
const excelUploadMiddleware = createFileUploadMiddleware({
  destination: './uploads/temp',
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/haansoftxlsx'
  ]
});

/**
 * @route POST /api/youtube/multi-channel-weekly
 * @desc 엑셀 파일 기반 다중 채널 주간 영상 메타데이터 수집
 * @body {string} apiKey - YouTube Data API v3 API 키
 * @body {string} date - 기준 날짜 (선택, YYYY-MM-DD 형식)
 * @file {file} excelFile - 엑셀 파일 (채널명, 유튜브 URL, 라이브 URL)
 * @access Private
 */
router.post('/multi-channel-weekly', authenticate, excelUploadMiddleware.single('excelFile'), youtubeController.collectMultiChannelWeekly);

/**
 * @route GET /api/youtube/download/:filename
 * @desc CSV 파일 다운로드
 * @param {string} filename - 다운로드할 파일명
 * @access Private
 */
router.get('/download/:filename', authenticate, youtubeController.downloadCSV);

/**
 * @route GET /api/youtube/quota-status
 * @desc YouTube API 할당량 상태 확인
 * @access Private
 */
router.get('/quota-status', authenticate, youtubeController.getQuotaStatus);

module.exports = router;

