const metricsService = require('../services/metrics.service');
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

/**
 * 메트릭 개요 조회 엔드포인트
 * 
 * GET /api/metrics/overview?projectId=1&from=2024-01-01&to=2024-12-31
 * 
 * 테스트 예시:
 * 
 * 1. curl (인증 토큰 필요):
 *    curl -H "Authorization: Bearer <token>" http://localhost:8080/api/metrics/overview?projectId=1
 * 
 * 2. curl (날짜 범위 포함):
 *    curl -H "Authorization: Bearer <token>" "http://localhost:8080/api/metrics/overview?projectId=1&from=2024-01-01&to=2024-12-31"
 * 
 * 3. 브라우저 (개발자 도구 콘솔에서):
 *    fetch('/api/metrics/overview?projectId=1', {
 *      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
 *    }).then(r => r.json()).then(console.log)
 * 
 * 4. PowerShell (Invoke-WebRequest):
 *    $headers = @{ "Authorization" = "Bearer <token>" }
 *    Invoke-WebRequest -Uri "http://localhost:8080/api/metrics/overview?projectId=1" -Headers $headers | Select-Object -ExpandProperty Content
 * 
 * 응답 형식:
 * {
 *   "success": true,
 *   "message": "Metrics overview retrieved successfully",
 *   "data": {
 *     "totalIssues": 100,
 *     "issuesByStatus": { "OPEN": 50, "IN_PROGRESS": 30, "RESOLVED": 20 },
 *     "issuesByCategory": { "버그": 40, "기능요청": 30, "기타": 30 },
 *     "issuesBySeverity": { "Sev1": 10, "Sev2": 20, "Sev3": 70 },
 *     "issuesPerDay": [{ "date": "2024-01-01", "count": 5 }, ...],
 *     "issuesHandledByAgent": { "Agent A": 30, "Agent B": 20, "Unassigned": 50 }
 *   },
 *   "timestamp": "2024-01-01T00:00:00.000Z"
 * }
 */
const getOverview = asyncMiddleware(async (req, res) => {
  const { projectId, from, to } = req.query;
  
  try {
    logger.debug('Metrics overview request', { projectId, from, to });
    
    const metrics = await metricsService.getOverviewMetrics({ projectId, from, to });
    
    logger.debug('Metrics overview retrieved successfully', { 
      totalIssues: metrics.totalIssues 
    });
    
    sendSuccess(res, metrics, 'Metrics overview retrieved successfully');
  } catch (error) {
    logger.error('Failed to load metrics overview', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      meta: error.meta,
      projectId,
      from,
      to
    });
    
    // Prisma 에러인 경우 더 자세한 정보 제공
    let errorMessage = 'Failed to load metrics overview';
    let statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
    
    if (error.code === 'P2002') {
      errorMessage = 'Unique constraint violation';
      statusCode = HTTP_STATUS.CONFLICT;
    } else if (error.code === 'P2025') {
      errorMessage = 'Record not found';
      statusCode = HTTP_STATUS.NOT_FOUND;
    } else if (error.message) {
      errorMessage = error.message;
      // 유효성 검사 에러는 400
      if (error.message.includes('Invalid') || error.message.includes('validation')) {
        statusCode = HTTP_STATUS.BAD_REQUEST;
      }
    }
    
    sendError(res, errorMessage, statusCode, {
      code: error.code,
      meta: error.meta
    });
  }
});

module.exports = {
  getOverview
};



