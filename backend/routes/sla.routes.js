// SLA Policy 라우트

const express = require('express');
const router = express.Router();
const slaController = require('../controllers/sla.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/auth.middleware');

/**
 * @route GET /api/projects/:projectId/sla
 * @desc 프로젝트의 SLA 정책 조회
 * @query {boolean} includeInactive - 비활성 정책 포함 여부
 * @access Private
 */
router.get('/projects/:projectId/sla', authenticate, slaController.getSlaPolicies);

/**
 * @route POST /api/projects/:projectId/sla
 * @desc SLA 정책 생성
 * @body {string} severity - 심각도 ('critical', 'high', 'medium', 'low' or number)
 * @body {number} responseSec - 응답 시간 (초)
 * @body {string} channel - 채널 ('discord', 'slack', 'email', 'webhook')
 * @body {string} target - 대상 (웹훅 URL 또는 이메일 주소)
 * @body {boolean} isActive - 활성화 여부 (기본: true)
 * @access Private (ADMIN or LEAD only)
 */
router.post('/projects/:projectId/sla', authenticate, requireRole(['ADMIN', 'LEAD']), slaController.createSlaPolicy);

/**
 * @route PUT /api/projects/:projectId/sla/:id
 * @desc SLA 정책 업데이트
 * @body {string} severity - 심각도
 * @body {number} responseSec - 응답 시간 (초)
 * @body {string} channel - 채널
 * @body {string} target - 대상
 * @body {boolean} isActive - 활성화 여부
 * @access Private (ADMIN or LEAD only)
 */
router.put('/projects/:projectId/sla/:id', authenticate, requireRole(['ADMIN', 'LEAD']), slaController.updateSlaPolicy);

/**
 * @route DELETE /api/projects/:projectId/sla/:id
 * @desc SLA 정책 삭제 (soft delete)
 * @access Private (ADMIN or LEAD only)
 */
router.delete('/projects/:projectId/sla/:id', authenticate, requireRole(['ADMIN', 'LEAD']), slaController.deleteSlaPolicy);

module.exports = router;























