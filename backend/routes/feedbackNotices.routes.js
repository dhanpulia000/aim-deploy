// 고객사 피드백 공지사항 라우트

const express = require('express');
const router = express.Router();
const feedbackNoticesController = require('../controllers/feedbackNotices.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const { asyncHandler } = require('../middlewares/error.middleware');

// 모든 공지사항 조회 (인증 필요)
router.get('/', authenticate, asyncHandler(feedbackNoticesController.getAllNotices));

// 공지사항 상세 조회 (인증 필요)
router.get('/:id', authenticate, asyncHandler(feedbackNoticesController.getNoticeById));

// 공지사항 생성 (ADMIN, LEAD, SUPERADMIN 권한 필요)
router.post('/', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), asyncHandler(feedbackNoticesController.createNotice));

// 공지사항 열람 기록 (인증 필요)
router.post('/:id/read', authenticate, asyncHandler(feedbackNoticesController.markNoticeAsRead));

// 공지사항 수정 (ADMIN, LEAD, SUPERADMIN 권한 필요)
router.put('/:id', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), asyncHandler(feedbackNoticesController.updateNotice));

// 공지사항 종료 (ADMIN, LEAD, SUPERADMIN 권한 필요)
router.post('/:id/end', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), asyncHandler(feedbackNoticesController.endNotice));

// 공지사항 삭제 (ADMIN, LEAD, SUPERADMIN 권한 필요)
router.delete('/:id', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), asyncHandler(feedbackNoticesController.deleteNotice));

module.exports = router;






