// Issues 라우트

const express = require('express');
const router = express.Router();
const issuesController = require('../controllers/issues.controller');
const screenshotController = require('../controllers/screenshot.controller');
const { authenticate, rateLimit } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validation.middleware');
const { 
  issueIdSchema, 
  addCommentSchema, 
  assignIssueSchema,
  commentWatchPatchSchema
} = require('../validators/issues.validator');
const { createFileUploadMiddleware } = require('../services/files.service');

// 이미지 업로드 미들웨어 (클립보드 붙여넣기용)
const imageUploadMiddleware = createFileUploadMiddleware({
  destination: './uploads/temp',
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
});

/**
 * @route GET /api/issues
 * @desc 모든 이슈 조회 (카테고리 자동 분류 포함)
 * @query {string} agentId - 특정 에이전트 필터
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @query {number} severity - 심각도 필터 (1, 2, 3)
 * @query {string} status - 상태 필터
 * @query {string} category - 카테고리 필터
 * @query {number} limit - 최대 개수 (기본: 1000)
 * @query {number} offset - 오프셋 (기본: 0)
 * @access Public
 */
router.get('/', issuesController.getAllIssues);

/**
 * @route GET /api/issues/stats
 * @desc 카테고리별 통계 조회
 * @query {string} agentId - 특정 에이전트 필터
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @access Public
 */
router.get('/stats', issuesController.getCategoryStatistics);

/**
 * @route GET /api/issues/game-counts
 * @desc 게임별 이슈 카운트(총/Sev1/열림) 조회 (빠른 메인 화면용)
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD) (선택, 기본: 오늘 KST)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD) (선택, 기본: 오늘 KST)
 * @query {number} projectId - 프로젝트 ID (선택)
 * @access Public
 */
router.get('/game-counts', issuesController.getGameIssueCounts);

/**
 * @route GET /api/issues/agent/:agentId
 * @desc 특정 에이전트의 이슈 조회
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @query {number} severity - 심각도 필터
 * @query {string} status - 상태 필터
 * @query {string} category - 카테고리 필터
 * @access Public
 */
router.get('/agent/:agentId', issuesController.getIssuesByAgent);

/**
 * @route POST /api/issues/:issueId/check
 * @desc 이슈 확인 (URL 클릭 또는 수동 체크)
 * @body {string} agentId - 에이전트 ID (필수)
 * @access Public
 */
router.post('/:issueId/check', issuesController.checkIssue);

/**
 * @route POST /api/issues/:issueId/process
 * @desc 이슈 처리 완료 체크
 * @body {string} agentId - 에이전트 ID (필수)
 * @access Public
 */
router.post('/:issueId/process', issuesController.processIssue);

/**
 * @route POST /api/issues/:issueId/exclude-from-report
 * @desc 이슈를 보고서에서 제외 (일일 보고서 및 모니터링 대응에서 제외, 완료 처리)
 * @body {string} agentId - 에이전트 ID
 * @access Private (인증 필요)
 */
router.post('/:issueId/exclude-from-report', authenticate, issuesController.excludeFromReport);

/**
 * @route POST /api/issues/:issueId/assign
 * @desc 이슈 담당자 지정/변경
 * @access Private
 */
router.post('/:issueId/assign', authenticate, validate(issueIdSchema), validate(assignIssueSchema), issuesController.assignIssue);

/**
 * @route POST /api/issues/:issueId/status
 * @desc 이슈 상태 변경
 * @access Private
 */
router.post('/:issueId/status', authenticate, issuesController.updateIssueStatus);

/**
 * @route GET /api/issues/:issueId/comments
 * @desc 이슈 코멘트 조회
 * @access Private
 */
router.get('/:issueId/comments', authenticate, issuesController.getIssueComments);

/**
 * @route GET /api/issues/:issueId/comment-watch
 * @desc 네이버 카페 원문 이슈 댓글 주기 감시 설정 조회
 * @access Private
 */
router.get('/:issueId/comment-watch', authenticate, validate(issueIdSchema), issuesController.getCommentWatch);

/**
 * @route PATCH /api/issues/:issueId/comment-watch
 * @desc 댓글 주기 감시 on/off 및 간격(분)
 * @access Private
 */
router.patch('/:issueId/comment-watch', authenticate, validate(issueIdSchema), validate(commentWatchPatchSchema), issuesController.patchCommentWatch);

/**
 * @route GET /api/issues/comment-watches
 * @desc 댓글 관리 모드로 등록된 이슈 목록
 * @query {boolean|string} enabledOnly - 기본 true
 * @query {number} projectId - 선택
 * @query {number} limit - 기본 50
 * @query {number} offset - 기본 0
 * @access Private
 */
router.get('/comment-watches', authenticate, issuesController.getCommentWatches);

/**
 * @route POST /api/issues/:issueId/comments
 * @desc 이슈 코멘트 작성
 * @access Private
 */
router.post('/:issueId/comments', authenticate, validate(issueIdSchema), validate(addCommentSchema), issuesController.addIssueComment);

/**
 * @route PUT /api/issues/:issueId
 * @desc 이슈 상태 업데이트
 * @body {string} status - 상태 (new, triage, in_progress, waiting, resolved)
 * @body {number} severity - 심각도 (1, 2, 3)
 * @body {string} assigneeId - 담당자 ID
 * @access Public
 */
router.put('/:issueId', rateLimit(60000, 60), issuesController.updateIssue);

/**
 * @route GET /api/issues/:id/share-logs
 * @desc 이슈 공유 로그 조회
 * @access Private
 */
router.get('/:id/share-logs', authenticate, issuesController.getIssueShareLogs);

/**
 * @route GET /api/issues/slack-channels
 * @desc 슬랙 채널 목록 가져오기
 * @access Private
 */
router.get('/slack-channels', authenticate, issuesController.getSlackChannels);

/**
 * @route GET /api/issues/slack-users
 * @desc 슬랙 사용자 목록 가져오기
 * @access Private
 */
router.get('/slack-users', authenticate, issuesController.getSlackUsers);

/**
 * @route POST /api/issues/:id/share
 * @desc 이슈를 Slack으로 공유
 * @body {string} target - 공유 대상 ('Client_Channel', 'Internal_Channel')
 * @body {string} customMessage - 사용자 지정 메시지 (선택)
 * @body {string} channel - Slack 채널 ID 또는 이름 (Bot API 사용 시, 선택)
 * @access Private
 */
router.post('/:id/share', authenticate, issuesController.shareIssue);

/**
 * @route POST /api/issues/:issueId/capture-screenshot
 * @desc 기존 이슈에 대해 수동으로 스크린샷 캡처
 * @access Private
 */
router.post('/:issueId/capture-screenshot', authenticate, rateLimit(60000, 30), screenshotController.captureScreenshot);

/**
 * @route POST /api/issues/:id/upload-image
 * @desc 이슈에 이미지 업로드 (클립보드 붙여넣기용)
 * @access Private
 */
router.post('/:id/upload-image', authenticate, rateLimit(60000, 30), imageUploadMiddleware.single('image'), issuesController.uploadIssueImage);

// 비디오 업로드 미들웨어 (비디오 파일 허용, 최대 100MB)
const videoUploadMiddleware = createFileUploadMiddleware({
  destination: './uploads',
  maxSize: 100 * 1024 * 1024, // 100MB
  allowedTypes: [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm'
  ]
});

/**
 * @route POST /api/issues/:id/upload-video
 * @desc 이슈에 비디오 업로드 (캡처 클립용)
 * @access Private
 */
router.post('/:id/upload-video', authenticate, rateLimit(60000, 20), videoUploadMiddleware.single('video'), issuesController.uploadIssueVideo);

/**
 * @route POST /api/issues/:issueId/analyze-sentiment
 * @desc 이슈의 Sentiment(사용자 성향) 분석
 * @query {number} projectId - 프로젝트 ID (선택)
 * @access Private
 */
router.post('/:issueId/analyze-sentiment', authenticate, issuesController.analyzeSentiment);

/**
 * @route GET /api/issues/clan
 * @desc 클랜 관련 게시글 조회 (알림 규칙 체크 포함)
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @query {number} projectId - 프로젝트 ID (선택)
 * @query {number} limit - 최대 개수
 * @query {number} offset - 오프셋
 * @access Public
 */
router.get('/clan', issuesController.getClanIssues);

/**
 * @route GET /api/issues/card-exchange/daily-counts
 * @desc 카드 교환 일별 건수 (이슈 수집 시각 createdAt, KST 날짜 기준)
 * @query {string} startDate - 시작 (YYYY-MM-DD, 필수)
 * @query {string} endDate - 종료 (YYYY-MM-DD, 필수)
 * @query {number} projectId - 프로젝트 ID (선택)
 * @access Public
 */
router.get('/card-exchange/daily-counts', issuesController.getCardExchangeDailyIngestCounts);

/**
 * @route GET /api/issues/card-exchange
 * @desc 카드 교환(네이버 카페 메뉴) 게시글 조회
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @query {number} projectId - 프로젝트 ID (선택)
 * @query {number} limit - 최대 개수
 * @query {number} offset - 오프셋
 * @access Public
 */
router.get('/card-exchange', issuesController.getCardExchangeIssues);

/**
 * @route GET /api/issues/monitored-board-stats
 * @desc 모니터링 게시판별 이슈 건수 (날짜·프로젝트 선택)
 * @query {string} startDate - YYYY-MM-DD (선택, 없으면 날짜 제한 없음 — 목록 기준 건수)
 * @query {string} endDate - YYYY-MM-DD (선택)
 * @query {number} projectId - 프로젝트 (선택)
 * @query {string} includeInactive - true면 비활성/비활성화 보드 포함 (기본 false)
 * @query {string} includeListBased - true면 네이버 목록 페이지를 열어 기간 내 행 수에 가까운 집계(느림, Playwright)
 * @query {number} maxPages - 목록 페이지 최대 (기본 10, 최대 20). FE 메뉴 URL은 1페이지만 읽음.
 * @access Public
 */
router.get('/monitored-board-stats', issuesController.getMonitoredBoardIssueStats);

/**
 * @route GET /api/issues/same-content-groups
 * @desc 동일 출처(externalPostId) 또는 동일 제목(summary)으로 묶인 이슈 그룹 조회 (따로 관리용)
 * @query {number} projectId - 프로젝트 ID (선택)
 * @query {string} startDate - 시작 날짜 YYYY-MM-DD (선택)
 * @query {string} endDate - 종료 날짜 YYYY-MM-DD (선택)
 */
router.get('/same-content-groups', issuesController.getSameContentGroups);

/**
 * @route GET /api/issues/:issueId
 * @desc 단일 이슈 상세 (commentWatch 메타 포함)
 * @access Private
 */
router.get('/:issueId', authenticate, validate(issueIdSchema), issuesController.getIssue);

module.exports = router;

