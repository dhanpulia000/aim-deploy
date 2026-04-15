// Agents 컨트롤러

const agentsService = require('../services/agents.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const { parseProjectId } = require('../utils/parsers');
const logger = require('../utils/logger');

/**
 * 모든 에이전트 조회
 */
const getAllAgents = asyncMiddleware(async (req, res) => {
  const { includeInactive, projectId } = req.query;
  
  try {
    const agents = await agentsService.getAllAgents({
      includeInactive: includeInactive === 'true',
      projectId: parseProjectId(projectId)
    });
    sendSuccess(res, agents, 'Agents retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve agents', { error: error.message });
    sendError(res, 'Failed to retrieve agents', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 특정 에이전트 조회
 */
const getAgentById = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  try {
    const agent = await agentsService.getAgentById(agentId);
    if (!agent) {
      return sendError(res, 'Agent not found', HTTP_STATUS.NOT_FOUND);
    }
    sendSuccess(res, agent, 'Agent retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve agent', { error: error.message, agentId });
    sendError(res, 'Failed to retrieve agent', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 에이전트 생성
 * 
 * Request body:
 * - name: string (required)
 * - email: string (optional, required if createUserAccount is true)
 * - password: string (optional, required if createUserAccount is true)
 * - createUserAccount: boolean (optional, default: false)
 * - ... 기타 에이전트 필드
 */
const createAgent = asyncMiddleware(async (req, res) => {
  const agentData = req.body;
  const { createUserAccount, password, ...restAgentData } = agentData;
  
  if (!agentData.name) {
    return sendValidationError(res, [{ field: 'name', message: 'Agent name is required' }]);
  }
  
  try {
    const shouldCreateUser = createUserAccount === true || createUserAccount === 'true';
    const userPassword = shouldCreateUser ? password : null;
    
    const agent = await agentsService.createAgent(restAgentData, shouldCreateUser, userPassword);
    sendSuccess(res, agent, 'Agent created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create agent', { error: error.message, agentData: { ...agentData, password: '[REDACTED]' } });
    sendError(res, 'Failed to create agent', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 에이전트 수정
 */
const updateAgent = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  const updateData = req.body;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  try {
    const agent = await agentsService.updateAgent(agentId, updateData);
    
    // 상태 변경 시 WebSocket으로 실시간 업데이트 브로드캐스트
    if (updateData.status !== undefined) {
      const publisher = require('../realtime/publisher');
      publisher.broadcastAgentStatusUpdate(
        agent.projectId || null,
        agent.id,
        agent.status,
        {
          handling: agent.handling,
          todayResolved: agent.todayResolved,
          avgHandleSec: agent.avgHandleSec
        }
      );
    }
    
    sendSuccess(res, agent, 'Agent updated successfully');
  } catch (error) {
    logger.error('Failed to update agent', { error: error.message, agentId });
    sendError(res, 'Failed to update agent', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 에이전트 삭제 (소프트 삭제)
 */
const deleteAgent = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  try {
    const agent = await agentsService.deleteAgent(agentId);
    sendSuccess(res, agent, 'Agent deleted successfully');
  } catch (error) {
    logger.error('Failed to delete agent', { error: error.message, agentId });
    sendError(res, 'Failed to delete agent', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

module.exports = {
  getAllAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent
};







