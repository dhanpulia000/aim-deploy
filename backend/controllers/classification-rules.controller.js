const classificationRulesService = require('../services/classification-rules.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

const listRules = asyncMiddleware(async (req, res) => {
  const { projectId } = req.params;
  if (!projectId) {
    return sendValidationError(res, [{ field: 'projectId', message: 'projectId is required' }]);
  }

  try {
    const rules = await classificationRulesService.listRules(projectId);
    sendSuccess(res, rules, 'Classification rules retrieved successfully');
  } catch (error) {
    logger.error('Failed to list classification rules', { error: error.message, projectId });
    sendError(res, 'Failed to retrieve rules', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

const createRule = asyncMiddleware(async (req, res) => {
  const { projectId } = req.params;
  const { keyword, category, severity, isActive } = req.body || {};

  if (!keyword) {
    return sendValidationError(res, [{ field: 'keyword', message: 'Keyword is required' }]);
  }

  try {
    const rule = await classificationRulesService.createRule(projectId, {
      keyword,
      category,
      severity,
      isActive
    });
    sendSuccess(res, rule, 'Rule created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create classification rule', { error: error.message, projectId, keyword });
    sendError(res, error.message || 'Failed to create rule', HTTP_STATUS.BAD_REQUEST);
  }
});

const updateRule = asyncMiddleware(async (req, res) => {
  const { projectId, ruleId } = req.params;
  const payload = req.body || {};

  try {
    const rule = await classificationRulesService.updateRule(projectId, ruleId, payload);
    sendSuccess(res, rule, 'Rule updated successfully');
  } catch (error) {
    logger.error('Failed to update classification rule', { error: error.message, projectId, ruleId });
    sendError(res, error.message || 'Failed to update rule', HTTP_STATUS.BAD_REQUEST);
  }
});

const deleteRule = asyncMiddleware(async (req, res) => {
  const { projectId, ruleId } = req.params;
  try {
    await classificationRulesService.deleteRule(projectId, ruleId);
    sendSuccess(res, null, 'Rule deleted successfully', HTTP_STATUS.NO_CONTENT);
  } catch (error) {
    logger.error('Failed to delete classification rule', { error: error.message, projectId, ruleId });
    sendError(res, error.message || 'Failed to delete rule', HTTP_STATUS.BAD_REQUEST);
  }
});

module.exports = {
  listRules,
  createRule,
  updateRule,
  deleteRule
};



