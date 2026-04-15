/**
 * API 응답 표준화 미들웨어
 * 
 * 모든 API 응답이 일관된 형식을 갖도록 보장
 * { success: boolean, data: any, message?: string, error?: any, timestamp: string }
 */

const logger = require('../utils/logger');

/**
 * 응답 래퍼 미들웨어
 * res.json을 오버라이드하여 표준 형식으로 변환
 */
function standardizeResponse(req, res, next) {
  const originalJson = res.json.bind(res);
  
  // res.json을 오버라이드하여 표준 형식으로 변환
  res.json = function(data) {
    // 이미 표준 형식인 경우 (sendSuccess/sendError 사용)
    if (data && typeof data === 'object' && 'success' in data) {
      return originalJson(data);
    }
    
    // 표준 형식이 아닌 경우 변환
    const standardized = {
      success: res.statusCode >= 200 && res.statusCode < 300,
      data: data,
      message: res.statusCode >= 200 && res.statusCode < 300 
        ? 'Request successful' 
        : 'Request failed',
      timestamp: new Date().toISOString()
    };
    
    // 에러 응답인 경우 error 필드 추가
    if (res.statusCode >= 400) {
      standardized.error = data?.error || data?.message || data;
      standardized.data = null;
    }
    
    logger.warn('Non-standard API response detected, auto-standardized', {
      path: req.path,
      method: req.method,
      statusCode: res.statusCode,
      originalData: data
    });
    
    return originalJson(standardized);
  };
  
  next();
}

/**
 * 응답 검증 미들웨어 (개발 환경에서만)
 * 표준 형식을 따르지 않는 응답을 감지하고 경고
 */
function validateResponse(req, res, next) {
  if (process.env.NODE_ENV !== 'production') {
    const originalJson = res.json.bind(res);
    
    res.json = function(data) {
      // 표준 형식 검증
      if (!data || typeof data !== 'object' || !('success' in data)) {
        logger.warn('API response does not follow standard format', {
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          data: typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data
        });
      }
      
      return originalJson(data);
    };
  }
  
  next();
}

module.exports = {
  standardizeResponse,
  validateResponse
};




