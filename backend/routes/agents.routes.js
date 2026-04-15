// Agents 라우트

const express = require('express');
const router = express.Router();
const agentsController = require('../controllers/agents.controller');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');

/**
 * @route GET /api/agents
 * @desc 모든 에이전트 조회
 * @query {boolean} includeInactive - 비활성 에이전트 포함 여부
 * @access Public
 */
router.get('/', agentsController.getAllAgents);

/**
 * @route GET /api/agents/:agentId
 * @desc 특정 에이전트 조회
 * @access Public
 */
router.get('/:agentId', agentsController.getAgentById);

/**
 * @route POST /api/agents
 * @desc 에이전트 생성
 * @body {string} name - 에이전트 이름 (필수)
 * @body {string} avatar - 아바타 URL
 * @body {string} status - 상태 (available, busy, away, offline)
 * @body {number} handling - 현재 처리 중인 티켓 수
 * @body {number} todayResolved - 오늘 처리한 티켓 수
 * @body {number} avgHandleSec - 평균 처리 시간(초)
 * @body {Array<string>} channelFocus - 담당 게임 목록
 * @body {string} email - 이메일
 * @body {string} phone - 전화번호
 * @body {string} department - 부서
 * @body {string} position - 직책
 * @access Public
 */
router.post('/', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), agentsController.createAgent);

/**
 * @route PUT /api/agents/:agentId
 * @desc 에이전트 수정
 * @access Public
 */
router.put('/:agentId', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), agentsController.updateAgent);

/**
 * @route DELETE /api/agents/:agentId
 * @desc 에이전트 삭제 (소프트 삭제)
 * @access Public
 */
router.delete('/:agentId', authenticate, requireRole(['ADMIN', 'LEAD', 'SUPERADMIN']), agentsController.deleteAgent);

module.exports = router;







