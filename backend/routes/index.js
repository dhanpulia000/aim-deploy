// 메인 라우터 (API 라우트 통합)

const express = require('express');
const router = express.Router();

// 서브 라우터들
const reportsRoutes = require('./reports.routes');
const weeklyRoutes = require('./weekly.routes');
const weeklyController = require('../controllers/weekly.controller');
const filesRoutes = require('./files.routes');
const issuesRoutes = require('./issues.routes');
const articlesRoutes = require('./articles.routes');
const agentsRoutes = require('./agents.routes');
const schedulesRoutes = require('./schedules.routes');
const authRoutes = require('./auth.routes');
const projectsRoutes = require('./projects.routes');
const metricsRoutes = require('./metrics.routes');
const slaRoutes = require('./sla.routes');
const categoriesRoutes = require('./categories.routes');
const monitoredUrlsRoutes = require('./monitoredUrls.routes');
const monitoredBoardsRoutes = require('./monitoredBoards.routes');
const monitoringRoutes = require('./monitoring.routes');
const feedbackNoticesRoutes = require('./feedbackNotices.routes');
const debugRoutes = require('./debug.routes');
const ingestionRoutes = require('./ingestion.routes');
const aiPromptsRoutes = require('./aiPrompts.routes');
const agentStatsRoutes = require('./agentStats.routes');
const issueLockRoutes = require('./issueLock.routes');
const youtubeRoutes = require('./youtube.routes');
const partnerArchivingRoutes = require('./partnerArchiving.routes');
const workNotificationRoutes = require('./workNotification.routes');
const workChecklistRoutes = require('./workChecklist.routes');
const stepFloatingRoutes = require('./stepFloating.routes');
const handoverRoutes = require('./handover.routes');
const lineRoutes = require('./line.routes');
const realtimeRoutes = require('./realtime.routes');
const calendarRoutes = require('./calendar.routes');
const internalRoutes = require('./internal.routes');
const vectorSearchController = require('../controllers/vectorSearch.controller');
const agentStatsController = require('../controllers/agentStats.controller');
const { authenticate } = require('../middlewares/auth.middleware');
// 레거시 엔드포인트 호환을 위한 컨트롤러/미들웨어
const reportsController = require('../controllers/reports.controller');
const { createFileUploadMiddleware } = require('../services/files.service');
const legacyUpload = createFileUploadMiddleware({
  destination: './uploads',
  maxSize: 10 * 1024 * 1024,
  allowedTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/haansoftxlsx'
  ]
});

// API 라우트 등록
router.use('/reports', reportsRoutes);
router.use('/weekly-reports', weeklyRoutes);
router.use('/files', filesRoutes);
router.use('/issues', issuesRoutes);
router.use('/articles', articlesRoutes);
router.use('/agents', agentsRoutes);
router.use('/schedules', schedulesRoutes);
router.use('/auth', authRoutes);
router.use('/projects', projectsRoutes);
router.use('/metrics', metricsRoutes);
router.use('/calendar', calendarRoutes); // 업무 참고용 캘린더 (루트 라우트보다 먼저 등록)
router.use('/', slaRoutes); // SLA routes use /api/projects/:projectId/sla pattern
router.use('/', categoriesRoutes); // Categories routes
router.use('/monitored-urls', monitoredUrlsRoutes); // Monitored URLs routes
router.use('/monitored-boards', monitoredBoardsRoutes); // Monitored Boards routes
router.use('/monitoring', monitoringRoutes); // Monitoring control routes
router.use('/feedback-notices', feedbackNoticesRoutes); // Customer feedback notices routes
router.use('/debug', debugRoutes); // Debug routes (admin only)
router.use('/ingestion', ingestionRoutes); // Manual ingestion routes
router.use('/ai-prompts', aiPromptsRoutes); // AI prompts management routes (admin only)
// 게임·클랜 유입: 서브마운트보다 먼저 등록 (배포/라우팅 이슈 시에도 경로가 확실히 매칭되도록)
router.get('/agent-stats/game-volume/export', authenticate, agentStatsController.exportGameVolumeExcel);
router.get('/agent-stats/game-volume', authenticate, agentStatsController.getGameVolume);
router.use('/agent-stats', agentStatsRoutes); // Agent statistics routes (admin only)
router.use('/issue-locks', issueLockRoutes); // Issue locking for concurrent access control
router.use('/youtube', youtubeRoutes); // YouTube Data API routes
router.use('/partner-archiving', partnerArchivingRoutes); // Partner archiving (YouTube+TikTok)
router.use('/work-notifications', workNotificationRoutes); // Work notification routes
router.use('/work-checklist', workChecklistRoutes); // Work checklist (admin: items CRUD, agent: executions)
router.use('/step-floating', stepFloatingRoutes); // 스텝 플로팅 (업무 체크리스트 사이드 영역)
router.use('/handover', handoverRoutes); // 인수인계 내역
router.use('/line', lineRoutes); // LINE admin utilities
router.use('/realtime', realtimeRoutes); // WebSocket 즉시 브로드캐스트
router.use('/internal', internalRoutes); // 워커 전용 내부 콜백 (토큰 검증)

// === 벡터 검색 API 라우트 (PostgreSQL + pgvector) ===
router.post('/vector-search', vectorSearchController.searchSimilarIssues); // 벡터 검색
router.post('/vector-search/embed', vectorSearchController.createEmbedding); // 임베딩 생성 및 저장
router.get('/vector-search/status', vectorSearchController.getStatus); // 서비스 상태 확인

// === 업무 가이드 API 라우트 ===
const workGuideController = require('../controllers/workGuide.controller');
const guideUploadMiddleware = createFileUploadMiddleware({
  destination: './uploads/guides',
  maxSize: 50 * 1024 * 1024, // 50MB
  allowedTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/markdown',
    'text/html',
    'application/xhtml+xml'
  ]
});

router.get('/work-guides', workGuideController.listGuides); // 가이드 목록
router.get('/work-guides/:id', workGuideController.getGuide); // 가이드 조회
router.get('/work-guides/:id/file', workGuideController.downloadGuideFile); // 가이드 원본 파일 다운로드/뷰어
router.post('/work-guides', workGuideController.createGuide); // 가이드 생성
router.post('/work-guides/upload', guideUploadMiddleware.array('files', 20), workGuideController.uploadGuides); // 파일 업로드로 가이드 일괄 생성 (최대 20개)
router.patch('/work-guides/:id', workGuideController.updateGuide); // 가이드 수정
router.delete('/work-guides/:id', workGuideController.deleteGuide); // 가이드 삭제
router.post('/work-guides/search', workGuideController.searchGuides); // 가이드 검색

// === RAG 챗봇 API 라우트 ===
const ragChatController = require('../controllers/ragChat.controller');
router.post('/chat/ask', ragChatController.askQuestion); // 챗봇 질문

// === 레거시 호환 라우트들 (기존 프론트엔드 요청 유지) ===
// 기존: POST /api/upload-report
router.post('/upload-report', (req, res, next) => {
  legacyUpload.single('file')(req, res, (err) => {
    if (err) {
      // Multer 에러 처리
      const logger = require('../utils/logger');
      logger.error('Multer upload error', { 
        error: err.message, 
        code: err.code,
        field: err.field 
      });
      
      const { sendError, HTTP_STATUS } = require('../utils/http');
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, '파일 크기가 너무 큽니다. 최대 10MB까지 업로드 가능합니다.', HTTP_STATUS.BAD_REQUEST);
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return sendError(res, '예상치 못한 파일 필드입니다. 파일 필드명은 "file"이어야 합니다.', HTTP_STATUS.BAD_REQUEST);
      } else {
        return sendError(res, `파일 업로드 실패: ${err.message}`, HTTP_STATUS.BAD_REQUEST);
      }
    }
    next();
  });
}, reportsController.uploadExcelReport);

// 레거시 호환용 /api/data 엔드포인트 (옛 UI에서 호출하는 경우가 있어 더미 응답 제공)
router.get('/data', (req, res) => {
  // 현재 V2 프론트에서는 사용하지 않지만, 404 로그를 줄이기 위해 최소한의 구조 반환
  res.json({
    agents: [],
    tickets: []
  });
});
// // 기존: GET /api/agents (mock 기반)
// router.get('/agents', (req, res) => {
//   const { agents } = require('../libs/mock');
//   res.json(agents);
// });
// // 기존: GET /api/tickets (mock 기반)
// router.get('/tickets', (req, res) => {
//   const { tickets } = require('../libs/mock');
//   res.json(tickets);
// });
// // 기존: POST /api/tickets (샘플 추가, mock 기반)
// router.post('/tickets', (req, res) => {
//   const { addTicket } = require('../libs/mock');
//   const newTicket = { ...req.body, id: `t${Date.now()}`, createdAt: Date.now() };
//   addTicket(newTicket);
//   res.json(newTicket);
// });
// 기존: POST /api/generate-weekly-report (레거시 경로 직접 처리)
router.post('/generate-weekly-report', weeklyController.generateWeeklyReport);
// 기존: GET /api/weekly-reports/:agentId/download/:reportId 는 동일 경로 유지됨

// === 워커 수집 성공/실패 통계 (워커가 POST로 보고, GET으로 조회) ===
const workerStatsService = require('../services/workerStats.service');
const { sendSuccess } = require('../utils/http');

router.get('/worker-stats', (req, res) => {
  const stats = workerStatsService.getStats();
  sendSuccess(res, stats, 'Worker stats retrieved');
});

router.post('/worker-stats', express.json(), (req, res) => {
  const { workerName, success, fail, ...detail } = req.body || {};
  workerStatsService.recordRun(workerName, success, fail, detail);
  sendSuccess(res, { ok: true }, 'Worker stats recorded');
});

// 기본 API 상태 확인 (DB 체크 포함)
router.get('/health', (req, res) => {
  try {
    // DB 연결 체크 (better-sqlite3 사용)
    const { checkConnection, query } = require('../libs/db');
    const isConnected = checkConnection();
    
    if (!isConnected) {
      throw new Error('Database connection failed');
    }
    
    // 간단한 쿼리로 DB 응답성 확인
    query('SELECT 1 as test');
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      detail: 'db',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 서버 부하 점검 (메모리, uptime, DB, 워커 통계)
router.get('/health/load', (req, res) => {
  try {
    const { checkConnection, query } = require('../libs/db');
    const mem = process.memoryUsage();
    const toMB = (n) => Math.round((n / 1024 / 1024) * 100) / 100;
    const memory = {
      rssMB: toMB(mem.rss),
      heapTotalMB: toMB(mem.heapTotal),
      heapUsedMB: toMB(mem.heapUsed),
      externalMB: toMB(mem.external)
    };
    let db = { connected: false };
    try {
      db.connected = checkConnection();
      if (db.connected) query('SELECT 1 as test');
    } catch (e) {
      db.error = e.message;
    }
    const workers = workerStatsService.getStats();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory,
      db,
      workers
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API 문서 정보
router.get('/info', (req, res) => {
  res.json({
    name: 'Wallboard API',
    version: '1.0.0',
    description: 'Monitoring Wallboard API Server',
    endpoints: {
      reports: '/api/reports',
      workerStats: '/api/worker-stats',
      weeklyReports: '/api/weekly-reports',
      files: '/api/files',
      issues: '/api/issues',
      articles: '/api/articles',
      agents: '/api/agents',
      schedules: '/api/schedules',
      auth: '/api/auth',
      projects: '/api/projects',
      health: '/api/health',
      healthLoad: '/api/health/load'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

