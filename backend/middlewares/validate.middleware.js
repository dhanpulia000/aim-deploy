// 유효성 검사 미들웨어

const { sendValidationError } = require('../utils/http');

/**
 * 요청 본문 유효성 검사 미들웨어
 * @param {Object} schema - Joi 스키마 또는 유효성 검사 함수
 * @returns {Function} 미들웨어 함수
 */
function validateBody(schema) {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.body, { abortEarly: false });
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context.value
        }));
        
        return sendValidationError(res, errors);
      }
      
      req.body = value; // 검증된 값으로 교체
      next();
    } catch (err) {
      sendValidationError(res, [{ message: 'Validation schema error' }]);
    }
  };
}

/**
 * 쿼리 파라미터 유효성 검사 미들웨어
 * @param {Object} schema - Joi 스키마 또는 유효성 검사 함수
 * @returns {Function} 미들웨어 함수
 */
function validateQuery(schema) {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.query, { abortEarly: false });
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context.value
        }));
        
        return sendValidationError(res, errors);
      }
      
      req.query = value; // 검증된 값으로 교체
      next();
    } catch (err) {
      sendValidationError(res, [{ message: 'Query validation schema error' }]);
    }
  };
}

/**
 * URL 파라미터 유효성 검사 미들웨어
 * @param {Object} schema - Joi 스키마 또는 유효성 검사 함수
 * @returns {Function} 미들웨어 함수
 */
function validateParams(schema) {
  return (req, res, next) => {
    try {
      const { error, value } = schema.validate(req.params, { abortEarly: false });
      
      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context.value
        }));
        
        return sendValidationError(res, errors);
      }
      
      req.params = value; // 검증된 값으로 교체
      next();
    } catch (err) {
      sendValidationError(res, [{ message: 'Params validation schema error' }]);
    }
  };
}

/**
 * 파일 업로드 유효성 검사 미들웨어
 * @param {Object} options - 파일 검사 옵션
 * @returns {Function} 미들웨어 함수
 */
function validateFile(options = {}) {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB
    allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    required = true
  } = options;
  
  return (req, res, next) => {
    const file = req.file;
    
    if (required && !file) {
      return sendValidationError(res, [{ field: 'file', message: 'File is required' }]);
    }
    
    if (file) {
      // 파일 크기 검사
      if (file.size > maxSize) {
        return sendValidationError(res, [{ 
          field: 'file', 
          message: `File size exceeds ${maxSize / (1024 * 1024)}MB limit` 
        }]);
      }
      
      // 파일 타입 검사
      if (!allowedTypes.includes(file.mimetype)) {
        return sendValidationError(res, [{ 
          field: 'file', 
          message: `File type ${file.mimetype} is not allowed` 
        }]);
      }
    }
    
    next();
  };
}

/**
 * 간단한 필수 필드 검사 미들웨어
 * @param {Array} requiredFields - 필수 필드 배열
 * @returns {Function} 미들웨어 함수
 */
function requireFields(requiredFields) {
  return (req, res, next) => {
    const missingFields = requiredFields.filter(field => {
      const value = req.body[field];
      return value === undefined || value === null || value === '';
    });
    
    if (missingFields.length > 0) {
      const errors = missingFields.map(field => ({
        field,
        message: `${field} is required`
      }));
      
      return sendValidationError(res, errors);
    }
    
    next();
  };
}

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
  validateFile,
  requireFields
};

