/**
 * 모니터링 라우트
 */

const express = require('express');
const router = express.Router();
const monitoringController = require('../controllers/monitoring.controller');
const monitoredBoardsController = require('../controllers/monitoredBoards.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../middlewares/async.middleware');

// 모든 엔드포인트는 인증 필요
router.use(authenticate);

// 네이버 카페 크롤러 프로필(등록 UI용)
router.get('/crawler-games', asyncHandler(monitoringController.getCrawlerGames));

// 워커 상태 조회
router.get('/status', asyncHandler(monitoringController.getStatus));

// 키워드 관리
router.get('/keywords', asyncHandler(monitoringController.getKeywords));
router.post('/keywords', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoringController.createKeyword));
router.delete('/keywords/:id', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoringController.deleteKeyword));

// 최근 수집 로그 조회
router.get('/logs', asyncHandler(monitoringController.getLogs));

// 모니터링 대상 게시판 목록 (Admin/Lead)
router.get(
  '/boards',
  asyncHandler(monitoredBoardsController.listMonitoredBoards)
);

// DB 저장 목록(기간) 일별 스냅샷 — /boards/:id 와 절대 충돌하지 않도록 boards 밖에 둠
router.get(
  '/board-list-daily-snapshots',
  asyncHandler(monitoredBoardsController.getListDailySnapshots)
);
// 하위 호환 (일부 프록시/구버전 FE)
router.get(
  '/boards/list-daily-snapshots',
  asyncHandler(monitoredBoardsController.getListDailySnapshots)
);

// 설정 관리
router.get('/config/:key', asyncHandler(monitoringController.getConfig));
router.put('/config/:key', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoringController.setConfig));

// Slack 사용자(계정) 목록 조회 (Admin/Lead)
router.get('/slack/users', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoringController.listSlackUsers));

// 수동 크롤링 트리거
router.post('/trigger-scan', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoringController.triggerScan));

// 수동 슬랙 공지 수집 트리거 (모든 인증 사용자)
router.post('/trigger-slack-notice', asyncHandler(monitoringController.triggerSlackNoticeCollection));

// 게시판별 일일 게시글 수 조회 (RawLog 기준)
router.get('/boards/:id/daily-post-count', asyncHandler(monitoredBoardsController.getDailyPostCount));
// 게시판별 일일 게시글 수 - 목록 기준 (게시판 접속 후 50개씩 날짜 셀 파싱)
router.get('/boards/:id/daily-post-count-from-list', asyncHandler(monitoredBoardsController.getDailyPostCountFromList));

// 게시판 관리 (동적 크롤링 대상) - GET은 위에서 이미 정의됨
router.post('/boards', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoredBoardsController.createMonitoredBoard));
router.patch('/boards/:id', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoredBoardsController.updateMonitoredBoard));
router.delete('/boards/:id', requireRole(['ADMIN', 'LEAD']), asyncHandler(monitoredBoardsController.deleteMonitoredBoard));

module.exports = router;

