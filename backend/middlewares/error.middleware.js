// 에러 처리 미들웨어

const { sendError, HTTP_STATUS } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * 404 에러 처리 미들웨어
 * @param {Object} req - Express 요청 객체
 * @param {Object} res - Express 응답 객체
 * @param {Function} next - 다음 미들웨어 함수
 */
function handleNotFound(req, res, next) {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.status = HTTP_STATUS.NOT_FOUND;
  next(error);
}

/**
 * 글로벌 에러 처리 미들웨어
 * @param {Error} err - 에러 객체
 * @param {Object} req - Express 요청 객체
 * @param {Object} res - Express 응답 객체
 * @param {Function} next - 다음 미들웨어 함수
 */
function handleError(err, req, res, next) {
  // 응답이 이미 전송되었으면 아무것도 하지 않음
  if (res.headersSent) {
    return next(err);
  }

  // 에러 로깅
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err.code,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // 에러 상태 코드 설정
  const statusCode = err.status || err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = err.message || 'Internal server error';
  const errorDetails = process.env.NODE_ENV === 'development' ? err.stack : undefined;

  try {
    sendError(res, message, statusCode, errorDetails);
  } catch (sendErr) {
    logger.error('Failed to send error response', { error: sendErr.message });
    try {
      res.status(statusCode).setHeader('Content-Type', 'application/json').end(
        JSON.stringify({ success: false, message, error: errorDetails, timestamp: new Date().toISOString() })
      );
    } catch (e) {
      // 최후: 빈 응답 방지
      try {
        res.status(500).setHeader('Content-Type', 'application/json').end('{"success":false,"message":"Internal server error"}');
      } catch (_) {}
    }
  }
}

/**
 * 비동기 함수 래퍼 (에러 캐치용)
 * @param {Function} fn - 비동기 함수
 * @returns {Function} 래핑된 함수
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 요청 로깅 미들웨어
 * @param {Object} req - Express 요청 객체
 * @param {Object} res - Express 응답 객체
 * @param {Function} next - 다음 미들웨어 함수
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();
  
  // 응답 완료 시 로깅
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.logRequest(req, res, duration);
  });
  
  next();
}

module.exports = {
  handleNotFound,
  handleError,
  asyncHandler,
  requestLogger
};

