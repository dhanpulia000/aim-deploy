// Schedules 라우트

const express = require('express');
const router = express.Router();
const schedulesController = require('../controllers/schedules.controller');

/**
 * @route GET /api/schedules/range
 * @desc 날짜 범위의 스케줄 조회
 * @query {string} startDate - 시작 날짜 (YYYY-MM-DD)
 * @query {string} endDate - 종료 날짜 (YYYY-MM-DD)
 * @query {string} agentId - 에이전트 ID (선택)
 * @query {boolean} includeInactive - 비활성 스케줄 포함 여부
 * @access Public
 */
router.get('/range', schedulesController.getSchedulesByDateRange);

/**
 * @route GET /api/schedules/agent/:agentId
 * @desc 에이전트의 모든 스케줄 조회
 * @query {boolean} includeInactive - 비활성 스케줄 포함 여부
 * @access Public
 */
router.get('/agent/:agentId', schedulesController.getSchedulesByAgent);

/**
 * @route GET /api/schedules/date/:date
 * @desc 특정 날짜의 스케줄 조회 (YYYY-MM-DD)
 * @query {boolean} includeInactive - 비활성 스케줄 포함 여부
 * @access Public
 */
router.get('/date/:date', schedulesController.getSchedulesByDate);

/**
 * @route POST /api/schedules
 * @desc 스케줄 생성
 * @body {string} agentId - 에이전트 ID (필수)
 * @body {string} scheduleType - 스케줄 타입 (weekly, specific)
 * @body {number} dayOfWeek - 요일 (0=일요일, 6=토요일, weekly용)
 * @body {string} specificDate - 특정 날짜 (YYYY-MM-DD, specific용)
 * @body {string} startTime - 시작 시간 (HH:mm, 필수)
 * @body {string} endTime - 종료 시간 (HH:mm, 필수)
 * @body {string} workType - 근무 타입 (주간, 오후, 야간)
 * @body {boolean} isActive - 활성화 여부
 * @body {string} notes - 메모
 * @access Public
 */
router.post('/', schedulesController.createSchedule);

/**
 * @route PUT /api/schedules/:scheduleId
 * @desc 스케줄 수정
 * @access Public
 */
router.put('/:scheduleId', schedulesController.updateSchedule);

/**
 * @route DELETE /api/schedules/:scheduleId
 * @desc 스케줄 삭제
 * @access Public
 */
router.delete('/:scheduleId', schedulesController.deleteSchedule);

module.exports = router;

