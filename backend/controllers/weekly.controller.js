// Weekly Reports 컨트롤러

const weeklyService = require('../services/weekly.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

/**
 * 주간 보고서 생성
 */
const generateWeeklyReport = asyncMiddleware(async (req, res) => {
  const { agentId, reportType, startDate, endDate } = req.body;
  const options = req.body.options || { reportType, startDate, endDate };
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const weeklyReport = await weeklyService.generateWeeklyReport(agentId, options);
  sendSuccess(res, weeklyReport, 'Weekly report generated successfully', HTTP_STATUS.CREATED);
});

/**
 * 에이전트별 주간 보고서 목록 조회
 */
const getWeeklyReportsByAgent = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  const { limit = 10, offset = 0, orderBy = 'desc' } = req.query;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const options = {
    limit: parseInt(limit),
    offset: parseInt(offset),
    orderBy
  };
  
  const reports = await weeklyService.getWeeklyReportsByAgent(agentId, options);
  sendSuccess(res, reports, 'Weekly reports retrieved successfully');
});

/**
 * 주간 보고서 다운로드
 */
const downloadWeeklyReport = asyncMiddleware(async (req, res) => {
  const { agentId, reportId } = req.params;
  
  if (!agentId || !reportId) {
    return sendValidationError(res, [
      { field: 'agentId', message: 'Agent ID is required' },
      { field: 'reportId', message: 'Report ID is required' }
    ]);
  }
  
  try {
    const downloadInfo = await weeklyService.downloadWeeklyReport(reportId);
    
    res.setHeader('Content-Type', downloadInfo.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadInfo.filename}"`);
    res.setHeader('Content-Length', downloadInfo.buffer.length);
    
    res.send(downloadInfo.buffer);
  } catch (error) {
    logger.error('Weekly report download failed', { error: error.message, reportId });
    sendError(res, 'Weekly report download failed', HTTP_STATUS.NOT_FOUND, error.message);
  }
});

/**
 * 주간 보고서 삭제
 */
const deleteWeeklyReport = asyncMiddleware(async (req, res) => {
  const { reportId } = req.params;
  
  if (!reportId) {
    return sendValidationError(res, [{ field: 'reportId', message: 'Report ID is required' }]);
  }
  
  await weeklyService.deleteWeeklyReport(reportId);
  sendSuccess(res, null, 'Weekly report deleted successfully', HTTP_STATUS.NO_CONTENT);
});

/**
 * 주간 보고서 통계 조회
 */
const getWeeklyReportStatistics = asyncMiddleware(async (req, res) => {
  const { agentId } = req.params;
  
  if (!agentId) {
    return sendValidationError(res, [{ field: 'agentId', message: 'Agent ID is required' }]);
  }
  
  const statistics = await weeklyService.getWeeklyReportStatistics(agentId);
  sendSuccess(res, statistics, 'Weekly report statistics retrieved successfully');
});

module.exports = {
  generateWeeklyReport,
  getWeeklyReportsByAgent,
  downloadWeeklyReport,
  deleteWeeklyReport,
  getWeeklyReportStatistics
};
