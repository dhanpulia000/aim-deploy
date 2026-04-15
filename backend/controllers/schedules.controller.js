// Schedules 컨트롤러

const schedulesService = require('../services/schedules.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

/**
 * 에이전트의 스케줄 조회
 */
const getSchedulesByAgent = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  const { includeInactive } = req.query;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  try {
    const schedules = await schedulesService.getSchedulesByAgent(agentId, {
      includeInactive: includeInactive === 'true'
    });
    sendSuccess(res, schedules, 'Schedules retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve schedules', { error: error.message, agentId });
    sendError(res, 'Failed to retrieve schedules', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 특정 날짜의 스케줄 조회
 */
const getSchedulesByDate = asyncMiddleware(async (req, res) => {
  const { date } = req.params;
  const { includeInactive } = req.query;
  
  if (!date) {
    return sendValidationError(res, [{ field: 'date', message: 'Date is required (YYYY-MM-DD)' }]);
  }
  
  try {
    const schedules = await schedulesService.getSchedulesByDate(date, {
      includeInactive: includeInactive === 'true'
    });
    sendSuccess(res, schedules, 'Schedules retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve schedules by date', { error: error.message, date });
    sendError(res, 'Failed to retrieve schedules', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 날짜 범위의 스케줄 조회
 */
const getSchedulesByDateRange = asyncMiddleware(async (req, res) => {
  const { startDate, endDate } = req.query;
  const { agentId, includeInactive } = req.query;
  
  if (!startDate || !endDate) {
    return sendValidationError(res, [
      { field: 'startDate', message: 'Start date is required (YYYY-MM-DD)' },
      { field: 'endDate', message: 'End date is required (YYYY-MM-DD)' }
    ]);
  }
  
  try {
    const schedules = await schedulesService.getSchedulesByDateRange(startDate, endDate, {
      agentId,
      includeInactive: includeInactive === 'true'
    });
    sendSuccess(res, schedules, 'Schedules retrieved successfully');
  } catch (error) {
    logger.error('Failed to retrieve schedules by date range', { error: error.message, startDate, endDate });
    sendError(res, 'Failed to retrieve schedules', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 스케줄 생성
 */
const createSchedule = asyncMiddleware(async (req, res) => {
  const scheduleData = req.body;
  
  if (!scheduleData.agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  if (!scheduleData.startTime || !scheduleData.endTime) {
    return sendValidationError(res, [
      { field: 'startTime', message: 'Start time is required (HH:mm)' },
      { field: 'endTime', message: 'End time is required (HH:mm)' }
    ]);
  }
  
  try {
    const schedule = await schedulesService.createSchedule(scheduleData);
    sendSuccess(res, schedule, 'Schedule created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create schedule', { error: error.message, scheduleData });
    sendError(res, 'Failed to create schedule', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 스케줄 수정
 */
const updateSchedule = asyncMiddleware(async (req, res) => {
  const { scheduleId } = req.params;
  const updateData = req.body;
  
  if (!scheduleId) {
    return sendValidationError(res, [{ field: 'scheduleId', message: 'Schedule ID is required' }]);
  }
  
  try {
    const schedule = await schedulesService.updateSchedule(scheduleId, updateData);
    sendSuccess(res, schedule, 'Schedule updated successfully');
  } catch (error) {
    logger.error('Failed to update schedule', { error: error.message, scheduleId });
    sendError(res, 'Failed to update schedule', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 스케줄 삭제
 */
const deleteSchedule = asyncMiddleware(async (req, res) => {
  const { scheduleId } = req.params;
  
  if (!scheduleId) {
    return sendValidationError(res, [{ field: 'scheduleId', message: 'Schedule ID is required' }]);
  }
  
  try {
    await schedulesService.deleteSchedule(scheduleId);
    sendSuccess(res, null, 'Schedule deleted successfully', HTTP_STATUS.NO_CONTENT);
  } catch (error) {
    logger.error('Failed to delete schedule', { error: error.message, scheduleId });
    sendError(res, 'Failed to delete schedule', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

module.exports = {
  getSchedulesByAgent,
  getSchedulesByDate,
  getSchedulesByDateRange,
  createSchedule,
  updateSchedule,
  deleteSchedule
};







