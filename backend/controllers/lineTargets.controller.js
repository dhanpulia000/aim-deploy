// LINE chat target controller (admin)

const lineTargetsService = require('../services/lineTargets.service');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

async function listTargets(req, res) {
  try {
    const { type } = req.query;
    const targets = await lineTargetsService.listTargets({ type });
    return sendSuccess(res, targets, 'LINE 대상 목록을 조회했습니다.');
  } catch (error) {
    logger.error('[LineTargetsController] Failed to list targets', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'LINE 대상 목록 조회에 실패했습니다.', error.message);
  }
}

async function updateDisplayName(req, res) {
  try {
    const { id } = req.params;
    const { displayName } = req.body || {};
    const updated = await lineTargetsService.updateDisplayName(id, displayName);
    if (!updated) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'LINE 대상을 찾을 수 없습니다.');
    }
    return sendSuccess(res, updated, 'LINE 대상 라벨이 저장되었습니다.');
  } catch (error) {
    logger.error('[LineTargetsController] Failed to update displayName', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'LINE 대상 라벨 저장에 실패했습니다.', error.message);
  }
}

module.exports = { listTargets, updateDisplayName };

