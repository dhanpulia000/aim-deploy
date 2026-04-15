const express = require('express');
const router = express.Router();
const workChecklistController = require('../controllers/workChecklist.controller');
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');

// 항목 관리 (관리자만)
router.get('/items', workChecklistController.listItems);
router.post('/items', authenticate, requireAdmin(), express.json(), workChecklistController.createItem);
router.get('/items/:id', workChecklistController.getItem);
router.patch('/items/:id', authenticate, requireAdmin(), express.json(), workChecklistController.updateItem);
router.delete('/items/:id', authenticate, requireAdmin(), workChecklistController.deleteItem);
router.post('/items/reorder', authenticate, requireAdmin(), express.json(), workChecklistController.reorderItems);

// 체크리스트 상단 알림글 (GET: 누구나, PATCH: 관리자만)
router.get('/banner', workChecklistController.getBanner);
router.patch('/banner', authenticate, requireAdmin(), express.json(), workChecklistController.setBanner);

// 구분별 담당(조회만 — 에이전트 스케줄 기준, ?date= 필수에 가깝게 사용)
router.get('/assignees', authenticate, workChecklistController.listAssignees);

// 관리자: 날짜·작업구분별 에이전트 체크 현황 (경로를 /executions 보다 먼저 등록)
router.get('/executions/overview', authenticate, requireAdmin(), workChecklistController.getExecutionOverview);
// 로그인 사용자: 팀 전체 체크 현황 (에이전트 화면용)
router.get('/executions/team', authenticate, workChecklistController.getExecutionTeam);

// 에이전트: 내 체크리스트 조회 및 체크 (로그인 사용자)
router.get('/executions', authenticate, workChecklistController.getMyChecklist);
router.put('/executions', authenticate, express.json(), workChecklistController.setExecution);

module.exports = router;
