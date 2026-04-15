// Reports 라우트

const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');
const { createFileUploadMiddleware } = require('../services/files.service');
const { rateLimit } = require('../middlewares/auth.middleware');
const { getSourcesDir } = require('../services/weeklyVocReportFromExcel.service');
const { SOURCES_DIR: WEEKLY_PC_SOURCES_DIR } = require('../services/weeklyVocReportFromExcelPc.service');

// 파일 업로드 미들웨어
const uploadMiddleware = createFileUploadMiddleware({
  destination: './uploads',
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/haansoftxlsx'
  ]
});

// PUBGM/PUBGPC 주간보고서 소스 업로드 (platform 쿼리로 구분)
const weeklySourcesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require('fs');
    const platform = req.query?.platform === 'pc' ? 'pc' : 'mobile';
    const dir = getSourcesDir(platform);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    let name = (file.originalname && Buffer.from(file.originalname, 'latin1').toString('utf8')) || file.originalname || 'upload.xlsx';
    name = path.basename(name).replace(/[<>:"/\\|?*]/g, '_') || 'upload.xlsx';
    cb(null, name);
  }
});
const weeklySourcesUpload = multer({
  storage: weeklySourcesStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) return cb(null, true);
    cb(new Error('Only .xlsx, .xls files are allowed.'), false);
  }
}).single('file');

// PUBG PC 주간보고서 소스 업로드
const weeklyPcSourcesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require('fs');
    if (!fs.existsSync(WEEKLY_PC_SOURCES_DIR)) {
      fs.mkdirSync(WEEKLY_PC_SOURCES_DIR, { recursive: true });
    }
    cb(null, WEEKLY_PC_SOURCES_DIR);
  },
  filename: (req, file, cb) => {
    let name = (file.originalname && Buffer.from(file.originalname, 'latin1').toString('utf8')) || file.originalname || 'upload.xlsx';
    name = path.basename(name).replace(/[<>:"/\\|?*]/g, '_') || 'upload.xlsx';
    cb(null, name);
  }
});
const weeklyPcSourcesUpload = multer({
  storage: weeklyPcSourcesStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) return cb(null, true);
    cb(new Error('Only .xlsx, .xls files are allowed.'), false);
  }
}).single('file');

/**
 * @route GET /api/reports/weekly-sources
 * @desc PUBGM 주간보고서 소스 파일 목록
 */
router.get('/weekly-sources', reportsController.listWeeklySources);

/**
 * @route POST /api/reports/weekly-sources/upload
 * @desc PUBGM 주간보고서 소스 파일 업로드
 */
router.post('/weekly-sources/upload', rateLimit(60000, 20), weeklySourcesUpload, reportsController.uploadWeeklySource);

/**
 * @route DELETE /api/reports/weekly-sources/:sourceId
 * @desc PUBGM 주간보고서 소스 파일 삭제
 */
router.delete('/weekly-sources/:sourceId', reportsController.deleteWeeklySource);

/**
 * @route POST /api/reports/weekly-sources/generate
 * @desc PUBGM 주간보고서 산출물 생성
 */
router.post('/weekly-sources/generate', reportsController.generateWeeklyVocReport);

/**
 * @route GET /api/reports/weekly-outputs
 * @desc PUBGM 주간보고서 산출물 목록
 */
router.get('/weekly-outputs', reportsController.listWeeklyOutputs);

/**
 * @route GET /api/reports/weekly-outputs/download
 * @desc PUBGM 주간보고서 산출물 다운로드 (?job=job_xxx&file=xxx.xlsx)
 */
router.get('/weekly-outputs/download', reportsController.downloadWeeklyOutput);

/**
 * @route DELETE /api/reports/weekly-outputs/:jobId
 * @desc PUBGM 주간보고서 산출물 삭제
 */
router.delete('/weekly-outputs/:jobId', reportsController.deleteWeeklyOutput);

/**
 * @route GET /api/reports/weekly-pc-sources
 * @desc PUBG PC 주간보고서 소스 파일 목록
 */
router.get('/weekly-pc-sources', reportsController.listWeeklyPcSources);

/**
 * @route POST /api/reports/weekly-pc-sources/upload
 * @desc PUBG PC 주간보고서 소스 파일 업로드
 */
router.post('/weekly-pc-sources/upload', rateLimit(60000, 20), weeklyPcSourcesUpload, reportsController.uploadWeeklyPcSource);

/**
 * @route DELETE /api/reports/weekly-pc-sources/:sourceId
 * @desc PUBG PC 주간보고서 소스 파일 삭제
 */
router.delete('/weekly-pc-sources/:sourceId', reportsController.deleteWeeklyPcSource);

/**
 * @route POST /api/reports/weekly-pc-sources/generate
 * @desc PUBG PC 주간보고서 산출물 생성
 */
router.post('/weekly-pc-sources/generate', reportsController.generateWeeklyPcVocReport);

/**
 * @route GET /api/reports/weekly-pc-outputs
 * @desc PUBG PC 주간보고서 산출물 목록
 */
router.get('/weekly-pc-outputs', reportsController.listWeeklyPcOutputs);

/**
 * @route GET /api/reports/weekly-pc-outputs/download
 * @desc PUBG PC 주간보고서 산출물 다운로드 (?jobId=job_xxx&file=xxx.xlsx)
 */
router.get('/weekly-pc-outputs/download', reportsController.downloadWeeklyPcOutput);

/**
 * @route DELETE /api/reports/weekly-pc-outputs/:jobId
 * @desc PUBG PC 주간보고서 산출물 삭제
 */
router.delete('/weekly-pc-outputs/:jobId', reportsController.deleteWeeklyPcOutput);

/**
 * @route GET /api/reports/daily/download
 * @desc 일일 보고서 엑셀 다운로드
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD 형식)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD 형식)
 * @access Public
 */
router.get('/daily/download', reportsController.downloadDailyReport);

/**
 * @route GET /api/reports/weekly/download
 * @desc 주간 SUMMARY 보고서 엑셀 다운로드
 * @access Public
 */
router.get('/weekly/download', reportsController.downloadWeeklyReport);

/**
 * @route POST /api/reports/weekly/from-excel
 * @desc 엑셀 파일로부터 주간 보고서 생성 및 다운로드
 * @access Public
 */
router.post('/weekly/from-excel', uploadMiddleware.single('file'), reportsController.generateWeeklyReportFromExcel);

/**
 * @route GET /api/reports/:agentId
 * @desc 에이전트별 보고서 목록 조회
 * @access Public
 */
router.get('/:agentId', reportsController.getReportsByAgent);

/**
 * @route POST /api/reports
 * @desc 보고서 생성
 * @access Public
 */
router.post('/', reportsController.createReport);

/**
 * @route PUT /api/reports/:reportId
 * @desc 보고서 업데이트
 * @access Public
 */
router.put('/:reportId', reportsController.updateReport);

/**
 * @route DELETE /api/reports/:agentId/:reportId
 * @desc 보고서 삭제
 * @access Public
 */
router.delete('/:agentId/:reportId', reportsController.deleteReport);

/**
 * @route POST /api/reports/upload
 * @desc Excel 보고서 업로드 및 파싱
 * @access Public
 */
router.post('/upload', rateLimit(60000, 20), uploadMiddleware.single('file'), reportsController.uploadExcelReport);

/**
 * @route GET /api/reports/:agentId/statistics
 * @desc 보고서 통계 조회
 * @access Public
 */
router.get('/:agentId/statistics', reportsController.getReportStatistics);

module.exports = router;

