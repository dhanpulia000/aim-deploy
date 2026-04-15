const jwt = require('jsonwebtoken');
const { HTTP_STATUS, sendError } = require('../utils/http');
const logger = require('../utils/logger');

// TODO: Production 환경에서는 반드시 환경 변수로 설정해야 합니다
const JWT_SECRET = process.env.JWT_SECRET || 'DEV_SECRET_CHANGE_IN_PRODUCTION';

/**
 * Extract bearer token from headers
 * @param {string} authorization
 * @returns {string|null}
 */
function extractToken(authorization = '') {
  if (!authorization || typeof authorization !== 'string') {
    return null;
  }
  const prefix = 'Bearer ';
  if (authorization.startsWith(prefix)) {
    return authorization.slice(prefix.length).trim();
  }
  return null;
}

/**
 * 인증이 필요한 요청에서 JWT 검증
 * 
 * Behavior:
 * - If Authorization header is missing or not Bearer format → 401 { error: 'Unauthorized' }
 * - If token is invalid/expired → 401 { error: 'Invalid token' }
 * - If token is valid → sets req.user and calls next()
 * - Never throws unhandled exceptions (always returns proper HTTP response)
 */
function authenticate(req, res, next) {
  try {
    // Extract token from Authorization header
    const token = extractToken(req.headers.authorization);

    // If no token, return 401
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify token
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Extract user info from token payload
      // Login route uses: { sub: user.id, email, role, name }
      req.user = {
        id: decoded.sub || decoded.id,
        email: decoded.email,
        role: decoded.role,
        name: decoded.name
      };
      
      // Token is valid, proceed
      next();
    } catch (verifyError) {
      // Token verification failed (invalid, expired, etc.)
      logger.warn('Invalid token', { error: verifyError.message });
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    // Unexpected error in middleware itself
    logger.error('Auth middleware error', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * 토큰이 있으면 사용자 정보를 붙이고, 없으면 그대로 진행
 */
function attachUserIfAvailable(req, res, next) {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.sub || decoded.id,
      email: decoded.email,
      role: decoded.role,
      name: decoded.name
    };
  } catch (error) {
    // 무시하고 비인증 상태로 진행
  }

  return next();
}

// 인증 관련 미들웨어
/**
 * 간단한 API 키 인증 미들웨어
 * @param {string} apiKey - 허용된 API 키
 * @returns {Function} 인증 미들웨어
 */
function apiKeyAuth(apiKey) {
  return (req, res, next) => {
    const providedKey = req.headers['x-api-key'] || req.query.apiKey;
    
    if (!providedKey) {
      logger.warn('API key missing', { ip: req.ip, url: req.originalUrl });
      return sendError(res, 'API key required', HTTP_STATUS.UNAUTHORIZED);
    }
    
    if (providedKey !== apiKey) {
      logger.warn('Invalid API key', { ip: req.ip, url: req.originalUrl });
      return sendError(res, 'Invalid API key', HTTP_STATUS.UNAUTHORIZED);
    }
    
    next();
  };
}

/**
 * 베어러 토큰 인증 미들웨어
 * @param {Function} verifyToken - 토큰 검증 함수
 * @returns {Function} 인증 미들웨어
 */
function bearerTokenAuth(verifyToken) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, 'Bearer token required', HTTP_STATUS.UNAUTHORIZED);
      }
      
      const token = authHeader.substring(7);
      const user = await verifyToken(token);
      
      if (!user) {
        return sendError(res, 'Invalid token', HTTP_STATUS.UNAUTHORIZED);
      }
      
      req.user = user;
      next();
    } catch (error) {
      logger.error('Token verification error', { error: error.message });
      sendError(res, 'Token verification failed', HTTP_STATUS.UNAUTHORIZED);
    }
  };
}

/**
 * 역할 기반 접근 제어 미들웨어
 * @param {Array} allowedRoles - 허용된 역할 배열
 * @returns {Function} 권한 검사 미들웨어
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required', HTTP_STATUS.UNAUTHORIZED);
    }
    
    const userRole = (req.user.role || '').toUpperCase();
    const normalizedAllowed = allowedRoles.map(role => role.toUpperCase());
    
    if (!normalizedAllowed.includes(userRole)) {
      logger.warn('Insufficient permissions', { 
        user: req.user.id, 
        role: userRole, 
        required: normalizedAllowed,
        url: req.originalUrl 
      });
      return sendError(res, 'Insufficient permissions', HTTP_STATUS.FORBIDDEN);
    }
    
    next();
  };
}

/**
 * 관리자 권한 검사 미들웨어
 * @returns {Function} 관리자 권한 검사 미들웨어
 */
function requireAdmin() {
  return requireRole(['ADMIN', 'LEAD', 'SUPERADMIN', 'admin', 'superadmin']);
}

/**
 * 사용자 권한 검사 미들웨어 (본인 또는 관리자)
 * @returns {Function} 사용자 권한 검사 미들웨어
 */
function requireUserOrAdmin() {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, 'Authentication required', HTTP_STATUS.UNAUTHORIZED);
    }
    
    const userId = req.params.userId || req.params.id;
    const normalizedRole = (req.user.role || '').toUpperCase();
    const isAdmin = ['ADMIN', 'LEAD', 'SUPERADMIN'].includes(normalizedRole);
    const isOwner = req.user.id === userId;
    
    if (!isAdmin && !isOwner) {
      logger.warn('Access denied', { 
        user: req.user.id, 
        target: userId,
        url: req.originalUrl 
      });
      return sendError(res, 'Access denied', HTTP_STATUS.FORBIDDEN);
    }
    
    next();
  };
}

/**
 * 요청 속도 제한 미들웨어
 * @param {number} windowMs - 시간 윈도우 (ms)
 * @param {number} maxRequests - 최대 요청 수
 * @returns {Function} 속도 제한 미들웨어
 */
function rateLimit(windowMs = 60000, maxRequests = 100) {
  const requests = new Map();
  
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    
    // 오래된 요청 기록 정리
    for (const [ip, data] of requests.entries()) {
      if (now - data.firstRequest > windowMs) {
        requests.delete(ip);
      }
    }
    
    const userRequests = requests.get(key);
    
    if (!userRequests) {
      requests.set(key, {
        count: 1,
        firstRequest: now
      });
      return next();
    }
    
    if (now - userRequests.firstRequest > windowMs) {
      // 윈도우 리셋
      requests.set(key, {
        count: 1,
        firstRequest: now
      });
      return next();
    }
    
    if (userRequests.count >= maxRequests) {
      logger.warn('Rate limit exceeded', { ip: key, count: userRequests.count });
      return sendError(res, 'Too many requests', HTTP_STATUS.SERVICE_UNAVAILABLE);
    }
    
    userRequests.count++;
    next();
  };
}

module.exports = {
  authenticate,
  attachUserIfAvailable,
  apiKeyAuth,
  bearerTokenAuth,
  requireRole,
  requireAdmin,
  requireUserOrAdmin,
  rateLimit
};

