const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');

/**
 * POST /api/auth/login
 *
 * OTP 비활성: { token, user }
 * OTP 활성: { loginChallengeId, expiresInSeconds, emailMasked }
 */
const login = asyncMiddleware(async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return sendValidationError(res, [
        { field: 'email', message: 'Email is required' },
        { field: 'password', message: 'Password is required' }
      ]);
    }

    if (req.app.get('dbAvailable') === false) {
      return sendError(
        res,
        '데이터베이스에 연결할 수 없습니다. PostgreSQL(Docker) 컨테이너가 실행 중인지, .env의 DATABASE_URL(호스트·포트·비밀번호)이 맞는지 확인한 뒤 백엔드를 다시 시작해 주세요.',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }

    let result;
    try {
      result = await authService.login(email, password);
    } catch (error) {
      if (error.code === 'SMTP_NOT_CONFIGURED' || error.code === 'SMTP_SEND_FAILED') {
        logger.error('Login OTP email failed', { error: error.message, email });
        return sendError(
          res,
          'Unable to complete login. Please try again later.',
          HTTP_STATUS.SERVICE_UNAVAILABLE
        );
      }
      const msg = String(error.message || '');
      if (msg.includes('Database connection failed')) {
        logger.error('Login service error', { error: error.message, email });
        return sendError(
          res,
          '데이터베이스 연결에 실패했습니다. PostgreSQL이 실행 중인지와 DATABASE_URL을 확인해 주세요.',
          HTTP_STATUS.SERVICE_UNAVAILABLE
        );
      }
      logger.error('Login service error', {
        error: error.message,
        stack: error.stack,
        email
      });

      return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }

    if (!result) {
      auditService.createAuditLog('LOGIN_FAILED', null, {
        email,
        ip: req.ip,
        userAgent: req.get('user-agent')
      }).catch(err => logger.error('Failed to create audit log', { error: err.message }));

      return sendError(res, 'Invalid email or password', HTTP_STATUS.UNAUTHORIZED);
    }

    if (result.kind === 'otp') {
      return sendSuccess(
        res,
        {
          loginChallengeId: result.loginChallengeId,
          expiresInSeconds: result.expiresInSeconds,
          emailMasked: result.emailMasked
        },
        'Verification code sent'
      );
    }

    auditService.createAuditLog('LOGIN', result.user.id, {
      email: result.user.email,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(err => logger.error('Failed to create audit log', { error: err.message }));

    return sendSuccess(res, {
      token: result.token,
      user: result.user
    }, 'Login successful');
  } catch (error) {
    logger.error('Login controller error', {
      error: error.message,
      stack: error.stack
    });
    if (!res.headersSent) {
      try {
        return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
      } catch (sendErr) {
        try {
          res.status(500).setHeader('Content-Type', 'application/json').end(
            JSON.stringify({ success: false, message: 'Internal server error', timestamp: new Date().toISOString() })
          );
        } catch (_) {}
      }
    }
  }
});

/**
 * POST /api/auth/login/otp
 */
const loginOtp = asyncMiddleware(async (req, res) => {
  try {
    const { loginChallengeId, code } = req.body || {};

    if (req.app.get('dbAvailable') === false) {
      return sendError(
        res,
        '데이터베이스에 연결할 수 없습니다. 백엔드 로그와 PostgreSQL 연결을 확인해 주세요.',
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }

    let result;
    try {
      result = await authService.verifyLoginOtp(loginChallengeId, code);
    } catch (error) {
      logger.error('verifyLoginOtp error', { error: error.message, stack: error.stack });
      return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }

    if (!result) {
      auditService.createAuditLog('LOGIN_FAILED', null, {
        loginChallengeId,
        ip: req.ip,
        userAgent: req.get('user-agent')
      }).catch(err => logger.error('Failed to create audit log', { error: err.message }));

      return sendError(res, 'Invalid email or password', HTTP_STATUS.UNAUTHORIZED);
    }

    auditService.createAuditLog('LOGIN', result.user.id, {
      email: result.user.email,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }).catch(err => logger.error('Failed to create audit log', { error: err.message }));

    return sendSuccess(res, {
      token: result.token,
      user: result.user
    }, 'Login successful');
  } catch (error) {
    logger.error('loginOtp controller error', { error: error.message, stack: error.stack });
    return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * POST /api/auth/login/otp/resend
 */
const resendLoginOtp = asyncMiddleware(async (req, res) => {
  try {
    const { loginChallengeId } = req.body || {};

    try {
      const data = await authService.resendLoginOtp(loginChallengeId);
      return sendSuccess(res, data, 'Code resent');
    } catch (error) {
      if (error.code === 'RESEND_COOLDOWN') {
        return sendError(
          res,
          'Please wait before requesting another code',
          HTTP_STATUS.TOO_MANY_REQUESTS,
          { retryAfterSeconds: error.retryAfterSeconds }
        );
      }
      if (error.code === 'CHALLENGE_NOT_FOUND' || error.code === 'CHALLENGE_EXPIRED') {
        return sendError(res, 'Invalid or expired session. Please sign in again.', HTTP_STATUS.UNAUTHORIZED);
      }
      if (error.code === 'SMTP_NOT_CONFIGURED' || error.code === 'SMTP_SEND_FAILED') {
        logger.error('Resend OTP email failed', { error: error.message });
        return sendError(
          res,
          'Unable to send email. Please try again later.',
          HTTP_STATUS.SERVICE_UNAVAILABLE
        );
      }
      logger.error('resendLoginOtp error', { error: error.message, stack: error.stack });
      return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  } catch (error) {
    logger.error('resendLoginOtp controller error', { error: error.message, stack: error.stack });
    return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * GET /api/auth/me
 */
const me = asyncMiddleware(async (req, res) => {
  try {
    if (!req.user) {
      return sendError(res, 'Unauthorized', HTTP_STATUS.UNAUTHORIZED);
    }

    const { id, email, role, name } = req.user;
    return sendSuccess(res, {
      user: { id, email, role, name }
    }, 'User information retrieved successfully');
  } catch (error) {
    logger.error('Error in /api/auth/me', {
      error: error.message,
      stack: error.stack
    });
    return sendError(res, 'Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

/**
 * POST /api/auth/users
 */
const createUser = asyncMiddleware(async (req, res) => {
  try {
    const { email, password, name, role = 'AGENT' } = req.body || {};

    if (!email || !password) {
      return sendValidationError(res, [
        { field: 'email', message: 'Email is required' },
        { field: 'password', message: 'Password is required' }
      ]);
    }

    const existingUser = await authService.getUserByEmail(email);
    if (existingUser) {
      return sendError(res, 'Email already exists', HTTP_STATUS.CONFLICT);
    }

    const user = await authService.createUser({
      email,
      password,
      name: name || email.split('@')[0],
      role
    });

    logger.info('User created', { userId: user.id, email: user.email, role: user.role });

    return sendSuccess(res, { user }, 'User created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create user', { error: error.message, email: req.body?.email });
    return sendError(res, 'Failed to create user', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

module.exports = {
  login,
  loginOtp,
  resendLoginOtp,
  me,
  createUser
};
