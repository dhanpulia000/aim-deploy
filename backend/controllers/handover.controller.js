/**
 * 인수인계 내역 API 컨트롤러
 * - 로그인 사용자 누구나 조회·작성 가능
 */

const handoverService = require('../services/handover.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

function listRecords(req, res) {
  try {
    const { workDate, workType, startDate, endDate } = req.query || {};
    const records = handoverService.listRecords({
      workDate: workDate || undefined,
      workType: workType || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
    return sendSuccess(res, { records }, 'Records retrieved successfully');
  } catch (err) {
    logger.error('[Handover] listRecords failed', { error: err.message });
    return sendError(res, 'Failed to retrieve records', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function getRecord(req, res) {
  try {
    const { workDate, workType } = req.params;
    const record = handoverService.getRecord(workDate, workType);
    if (!record) {
      return sendSuccess(res, { record: null }, 'Record not found');
    }
    return sendSuccess(res, { record }, 'Record retrieved successfully');
  } catch (err) {
    logger.error('[Handover] getRecord failed', { error: err.message });
    return sendError(res, 'Failed to retrieve record', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

function upsertRecord(req, res) {
  try {
    const { workDate, workType, content } = req.body || {};
    const user = req.user;

    if (!workDate || typeof workDate !== 'string' || !workDate.trim()) {
      return sendValidationError(res, [{ field: 'workDate', message: 'workDate is required (YYYY-MM-DD)' }]);
    }
    if (!workType || !handoverService.WORK_TYPES.includes(workType)) {
      return sendValidationError(res, [{ field: 'workType', message: 'workType must be 주간, 오후, 야간, or 정오' }]);
    }

    const dateStr = workDate.trim().slice(0, 10);
    const record = handoverService.upsertRecord({
      workDate: dateStr,
      workType,
      content: content !== undefined ? String(content).trim() : '',
      authorId: user?.id,
      authorName: user?.name || user?.email
    });

    return sendSuccess(res, { record }, 'Record saved successfully');
  } catch (err) {
    logger.error('[Handover] upsertRecord failed', { error: err.message });
    return sendError(res, 'Failed to save record', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  listRecords,
  getRecord,
  upsertRecord
};
