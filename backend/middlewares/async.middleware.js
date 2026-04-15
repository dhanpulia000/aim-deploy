// 비동기 처리 미들웨어

/**
 * 비동기 함수를 래핑하여 에러를 자동으로 캐치하는 미들웨어
 * @param {Function} fn - 비동기 함수
 * @returns {Function} 래핑된 미들웨어 함수
 */
function asyncMiddleware(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 여러 비동기 미들웨어를 순차적으로 실행
 * @param {Array} middlewares - 미들웨어 함수 배열
 * @returns {Function} 래핑된 미들웨어 함수
 */
function asyncSequence(middlewares) {
  return async (req, res, next) => {
    try {
      for (const middleware of middlewares) {
        await new Promise((resolve, reject) => {
          middleware(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * 타임아웃이 있는 비동기 미들웨어
 * @param {Function} fn - 비동기 함수
 * @param {number} timeout - 타임아웃 시간 (ms)
 * @returns {Function} 래핑된 미들웨어 함수
 */
function asyncWithTimeout(fn, timeout = 30000) {
  return (req, res, next) => {
    const timeoutId = setTimeout(() => {
      const error = new Error('Request timeout');
      error.status = 408;
      next(error);
    }, timeout);
    
    Promise.resolve(fn(req, res, next))
      .then(() => clearTimeout(timeoutId))
      .catch((err) => {
        clearTimeout(timeoutId);
        next(err);
      });
  };
}

/**
 * 재시도 로직이 있는 비동기 미들웨어
 * @param {Function} fn - 비동기 함수
 * @param {number} maxRetries - 최대 재시도 횟수
 * @param {number} delay - 재시도 간격 (ms)
 * @returns {Function} 래핑된 미들웨어 함수
 */
function asyncWithRetry(fn, maxRetries = 3, delay = 1000) {
  return async (req, res, next) => {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await new Promise((resolve, reject) => {
          fn(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        return; // 성공하면 종료
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt)));
        }
      }
    }
    
    next(lastError);
  };
}

/**
 * 병렬 실행 미들웨어
 * @param {Array} middlewares - 미들웨어 함수 배열
 * @returns {Function} 래핑된 미들웨어 함수
 */
function asyncParallel(middlewares) {
  return async (req, res, next) => {
    try {
      const promises = middlewares.map(middleware => 
        new Promise((resolve, reject) => {
          middleware(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        })
      );
      
      await Promise.all(promises);
      next();
    } catch (error) {
      next(error);
    }
  };
}

// asyncHandler는 asyncMiddleware의 별칭 (호환성을 위해)
const asyncHandler = asyncMiddleware;

module.exports = {
  asyncMiddleware,
  asyncHandler,
  asyncSequence,
  asyncWithTimeout,
  asyncWithRetry,
  asyncParallel
};

