// Files 라우트

const express = require('express');
const router = express.Router();
const filesController = require('../controllers/files.controller');
const { createFileUploadMiddleware } = require('../services/files.service');

// 파일 업로드 미들웨어
const uploadMiddleware = createFileUploadMiddleware({
  destination: './uploads',
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain',
    'application/json'
  ]
});

/**
 * @route POST /api/files/upload
 * @desc 파일 업로드
 * @access Public
 */
router.post('/upload', uploadMiddleware.single('file'), filesController.uploadFile);

/**
 * @route GET /api/files/download/:filename
 * @desc 파일 다운로드
 * @access Public
 */
router.get('/download/:filename', filesController.downloadFile);

/**
 * @route DELETE /api/files/:filename
 * @desc 파일 삭제
 * @access Public
 */
router.delete('/:filename', filesController.deleteFile);

/**
 * @route GET /api/files
 * @desc 파일 목록 조회
 * @access Public
 */
router.get('/', filesController.getFileList);

/**
 * @route GET /api/files/info/:filename
 * @desc 파일 정보 조회
 * @access Public
 */
router.get('/info/:filename', filesController.getFileInfo);

/**
 * @route POST /api/files/validate
 * @desc 파일 유효성 검사
 * @access Public
 */
router.post('/validate', uploadMiddleware.single('file'), filesController.validateFile);

module.exports = router;

