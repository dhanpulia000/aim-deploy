const express = require('express');
const router = express.Router();
const partnerArchivingController = require('../controllers/partnerArchiving.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { createFileUploadMiddleware } = require('../services/files.service');

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
 * @route POST /api/partner-archiving/multi-channel-weekly
 * @desc 엑셀 파일 기반 다중 플랫폼(YouTube+TikTok) 주간 메타데이터 수집
 * @body {string} date - 기준 날짜 (선택, YYYY-MM-DD)
 * @file {file} excelFile
 * @access Private
 */
router.post(
  '/multi-channel-weekly',
  authenticate,
  excelUploadMiddleware.single('excelFile'),
  partnerArchivingController.collectMultiChannelWeekly
);

/**
 * @route GET /api/partner-archiving/progress/:jobId
 * @desc 진행 상황 조회
 * @access Private
 */
router.get('/progress/:jobId', authenticate, partnerArchivingController.getProgress);

/**
 * @route GET /api/partner-archiving/download/:filename
 * @desc Excel 파일 다운로드
 * @access Private
 */
router.get('/download/:filename', authenticate, partnerArchivingController.downloadFile);

module.exports = router;

