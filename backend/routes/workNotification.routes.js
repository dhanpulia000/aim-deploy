// 업무 알림 라우트

const express = require('express');
const router = express.Router();
const workNotificationController = require('../controllers/workNotification.controller');

/**
 * @route GET /api/work-notifications
 * @desc 모든 업무 알림 조회
 * @query {boolean} includeInactive - 비활성 알림 포함 여부
 * @query {boolean} includeSent - 전송 완료된 알림 포함 여부
 * @access Public
 */
router.get('/', workNotificationController.getAllNotifications);

/**
 * @route GET /api/work-notifications/pending
 * @desc 전송 대기 중인 알림 조회
 * @access Public
 */
router.get('/pending', workNotificationController.getPendingNotifications);

/**
 * @route POST /api/work-notifications
 * @desc 업무 알림 생성
 * @body {string} workName - 업무명 (필수)
 * @body {string} notificationDate - 알림 날짜 (YYYY-MM-DD, 필수)
 * @body {string} notificationTime - 알림 시간 (HH:mm, 필수)
 * @body {string} lineChannelId - Line 채널 ID (필수)
 * @body {string} message - 추가 메시지 (선택)
 * @body {boolean} isActive - 활성화 여부 (기본값: true)
 * @access Public
 */
router.post('/', workNotificationController.createNotification);

/**
 * @route PUT /api/work-notifications/:notificationId
 * @desc 업무 알림 수정
 * @access Public
 */
router.put('/:notificationId', workNotificationController.updateNotification);

/**
 * @route DELETE /api/work-notifications/:notificationId
 * @desc 업무 알림 삭제
 * @access Public
 */
router.delete('/:notificationId', workNotificationController.deleteNotification);

module.exports = router;
