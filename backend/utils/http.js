// HTTP 관련 유틸리티 함수들

/**
 * HTTP 상태 코드 상수
 */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

/**
 * 성공 응답 생성
 * @param {Object} res - Express 응답 객체
 * @param {*} data - 응답 데이터
 * @param {string} message - 성공 메시지
 * @param {number} statusCode - HTTP 상태 코드
 * @returns {Object} JSON 응답
 */
function sendSuccess(res, data = null, message = 'Success', statusCode = HTTP_STATUS.OK) {
  // API 응답은 항상 캐시하지 않도록 설정 (ngrok, 프록시, 브라우저 캐시 방지)
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
}

/**
 * 에러 응답 생성
 * @param {Object} res - Express 응답 객체
 * @param {string} message - 에러 메시지
 * @param {number} statusCode - HTTP 상태 코드
 * @param {*} details - 에러 상세 정보
 * @returns {Object} JSON 응답
 */
function sendError(res, message = 'Internal Server Error', statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, details = null) {
  // API 응답은 항상 캐시하지 않도록 설정
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  return res.status(statusCode).json({
    success: false,
    message,
    error: details,
    timestamp: new Date().toISOString()
  });
}

/**
 * 유효성 검사 에러 응답
 * @param {Object} res - Express 응답 객체
 * @param {Array|Object} errors - 유효성 검사 에러
 * @returns {Object} JSON 응답
 */
function sendValidationError(res, errors) {
  // API 응답은 항상 캐시하지 않도록 설정
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
    success: false,
    message: 'Validation Error',
    errors,
    timestamp: new Date().toISOString()
  });
}

/**
 * 파일 다운로드 응답
 * @param {Object} res - Express 응답 객체
 * @param {Buffer|string} fileData - 파일 데이터
 * @param {string} filename - 파일명
 * @param {string} contentType - MIME 타입
 * @returns {Object} 파일 응답
 */
function sendFile(res, fileData, filename, contentType = 'application/octet-stream') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', fileData.length);
  
  return res.send(fileData);
}

/**
 * 페이지네이션 메타데이터 생성
 * @param {number} page - 현재 페이지
 * @param {number} limit - 페이지당 항목 수
 * @param {number} total - 전체 항목 수
 * @returns {Object} 페이지네이션 메타데이터
 */
function createPaginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext,
    hasPrev,
    nextPage: hasNext ? page + 1 : null,
    prevPage: hasPrev ? page - 1 : null
  };
}

/**
 * 페이지네이션된 응답 생성
 * @param {Object} res - Express 응답 객체
 * @param {Array} data - 데이터 배열
 * @param {number} page - 현재 페이지
 * @param {number} limit - 페이지당 항목 수
 * @param {number} total - 전체 항목 수
 * @returns {Object} JSON 응답
 */
function sendPaginatedResponse(res, data, page, limit, total) {
  const meta = createPaginationMeta(page, limit, total);
  
  return res.json({
    success: true,
    data,
    pagination: meta,
    timestamp: new Date().toISOString()
  });
}

/**
 * 요청 본문에서 페이지네이션 파라미터 추출
 * @param {Object} req - Express 요청 객체
 * @returns {Object} 페이지네이션 파라미터
 */
function extractPaginationParams(req) {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
}

/**
 * CORS 설정
 * @param {Object} options - CORS 옵션
 * @returns {Function} CORS 미들웨어
 */
function createCorsOptions(options = {}) {
  const defaultOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    ...options
  };
  
  return (req, res, next) => {
    res.header('Access-Control-Allow-Origin', defaultOptions.origin);
    res.header('Access-Control-Allow-Credentials', defaultOptions.credentials);
    res.header('Access-Control-Allow-Methods', defaultOptions.methods.join(', '));
    res.header('Access-Control-Allow-Headers', defaultOptions.allowedHeaders.join(', '));
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  };
}

module.exports = {
  HTTP_STATUS,
  sendSuccess,
  sendError,
  sendValidationError,
  sendFile,
  createPaginationMeta,
  sendPaginatedResponse,
  extractPaginationParams,
  createCorsOptions
};

