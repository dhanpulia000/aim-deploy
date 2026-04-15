// SLA Policy 컨트롤러

const slaService = require('../services/sla.service');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const { sendSuccess, sendError, sendValidationError } = require('../utils/http');
const { HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * 프로젝트의 SLA 정책 조회
 */
const getSlaPolicies = asyncMiddleware(async (req, res) => {
  const { projectId } = req.params;
  const { includeInactive } = req.query;

  if (!projectId) {
    return sendValidationError(res, [{ field: 'projectId', message: 'Project ID is required' }]);
  }

  try {
    const policies = includeInactive === 'true'
      ? await slaService.getAllSlaPolicies(projectId)
      : await slaService.getSlaPolicies(projectId);
    
    sendSuccess(res, policies, 'SLA policies retrieved successfully');
  } catch (error) {
    logger.error('Failed to get SLA policies', { error: error.message, projectId });
    sendError(res, 'Failed to get SLA policies', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * SLA 정책 생성
 */
const createSlaPolicy = asyncMiddleware(async (req, res) => {
  const { projectId } = req.params;
  const { severity, responseSec, channel, target, isActive } = req.body;

  if (!projectId) {
    return sendValidationError(res, [{ field: 'projectId', message: 'Project ID is required' }]);
  }

  if (!severity || !responseSec || !channel || !target) {
    return sendValidationError(res, [
      { field: 'severity', message: 'Severity is required' },
      { field: 'responseSec', message: 'Response time in seconds is required' },
      { field: 'channel', message: 'Channel is required' },
      { field: 'target', message: 'Target (webhook URL or email) is required' }
    ]);
  }

  try {
    const policy = await slaService.createSlaPolicy(projectId, {
      severity,
      responseSec,
      channel,
      target,
      isActive
    });

    sendSuccess(res, policy, 'SLA policy created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create SLA policy', { error: error.message, projectId });
    sendError(res, 'Failed to create SLA policy', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * SLA 정책 업데이트
 */
const updateSlaPolicy = asyncMiddleware(async (req, res) => {
  const { projectId, id } = req.params;
  const updateData = req.body;

  if (!projectId || !id) {
    return sendValidationError(res, [
      { field: 'projectId', message: 'Project ID is required' },
      { field: 'id', message: 'Policy ID is required' }
    ]);
  }

  try {
    const policy = await slaService.updateSlaPolicy(projectId, id, updateData);
    sendSuccess(res, policy, 'SLA policy updated successfully');
  } catch (error) {
    logger.error('Failed to update SLA policy', { error: error.message, projectId, policyId: id });
    sendError(res, 'Failed to update SLA policy', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * SLA 정책 삭제 (soft delete)
 */
const deleteSlaPolicy = asyncMiddleware(async (req, res) => {
  const { projectId, id } = req.params;

  if (!projectId || !id) {
    return sendValidationError(res, [
      { field: 'projectId', message: 'Project ID is required' },
      { field: 'id', message: 'Policy ID is required' }
    ]);
  }

  try {
    const policy = await slaService.deleteSlaPolicy(projectId, id);
    sendSuccess(res, policy, 'SLA policy deleted successfully');
  } catch (error) {
    logger.error('Failed to delete SLA policy', { error: error.message, projectId, policyId: id });
    sendError(res, 'Failed to delete SLA policy', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

module.exports = {
  getSlaPolicies,
  createSlaPolicy,
  updateSlaPolicy,
  deleteSlaPolicy
};























