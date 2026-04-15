const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { nanoid } = require('nanoid');
const { queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');
const loginOtpMail = require('./loginOtpMail.service');

// TODO: Production 환경에서는 반드시 환경 변수로 설정해야 합니다
const JWT_SECRET = process.env.JWT_SECRET || 'DEV_SECRET_CHANGE_IN_PRODUCTION';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const LOGIN_OTP_PEPPER = process.env.LOGIN_OTP_PEPPER || JWT_SECRET;

const OTP_EXPIRES_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

function isLoginOtpEnabled() {
  const v = String(process.env.LOGIN_EMAIL_OTP_ENABLED || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** 이메일 OTP(2FA) 대상: User.role 이 AGENT 인 계정만 */
function isAgentRoleUser(user) {
  return (user && String(user.role || '').toUpperCase()) === 'AGENT';
}

function buildTokenPayload(user) {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  try {
    const safeUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
    return safeUser;
  } catch (error) {
    logger.error('Error sanitizing user', {
      error: error.message,
      userId: user?.id,
      stack: error.stack
    });
    return {
      id: user?.id,
      email: user?.email,
      name: user?.name,
      role: user?.role
    };
  }
}

async function validatePassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * 이메일 마스킹 (예: ab***@example.com)
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

/**
 * 비밀번호 검증 후 DB User 행(비밀번호 포함) 또는 null
 */
async function validateCredentials(email, password) {
  if (!email || !password) {
    logger.warn('Login attempt with missing credentials', { hasEmail: !!email, hasPassword: !!password });
    return null;
  }

  let user;
  try {
    user = queryOne('SELECT * FROM User WHERE email = ?', [String(email)]);
  } catch (dbError) {
    logger.error('Database error during user lookup', {
      error: dbError.message,
      stack: dbError.stack,
      code: dbError.code,
      email
    });
    throw new Error(`Database connection failed: ${dbError.message}`);
  }

  if (!user) {
    logger.debug('User not found', { email });
    return null;
  }

  if (!user.password) {
    logger.error('User has no password hash', { userId: user.id, email: user.email });
    throw new Error('User account configuration error');
  }

  const isValid = await validatePassword(String(password), user.password);
  if (!isValid) {
    logger.debug('Invalid password', { email, userId: user.id });
    return null;
  }

  return user;
}

async function issueTokenForUser(user) {
  let token;
  try {
    token = jwt.sign(buildTokenPayload(user), JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });
  } catch (jwtError) {
    logger.error('JWT token generation failed', {
      error: jwtError.message,
      stack: jwtError.stack,
      userId: user.id,
      email: user.email
    });
    throw new Error(`Token generation failed: ${jwtError.message}`);
  }

  const sanitizedUser = sanitizeUser(user);
  if (!sanitizedUser || !sanitizedUser.id) {
    logger.error('Failed to sanitize user', {
      userId: user.id,
      email: user.email,
      sanitizedUser
    });
    throw new Error('User data processing failed');
  }

  logger.info('User logged in', { userId: user.id, email: user.email });

  return {
    token,
    user: sanitizedUser
  };
}

/**
 * OTP 코드: pepper로 해시 (bcrypt 대신 짧은 코드에 적합한 HMAC)
 */
function hashOtpCode(code) {
  const h = crypto.createHmac('sha256', LOGIN_OTP_PEPPER);
  h.update(String(code).trim(), 'utf8');
  return h.digest('hex');
}

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function createLoginOtpChallengeAndSend(user) {
  execute('DELETE FROM LoginOtpChallenge WHERE userId = ?', [user.id]);

  const id = nanoid(32);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = hashOtpCode(code);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS).toISOString();

  execute(
    `INSERT INTO LoginOtpChallenge (id, userId, codeHash, expiresAt, attemptCount, createdAt, lastResendAt)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [id, user.id, codeHash, expiresAt, now, now]
  );

  await loginOtpMail.sendLoginOtp(user.email, code);

  return {
    loginChallengeId: id,
    expiresInSeconds: Math.floor(OTP_EXPIRES_MS / 1000),
    emailMasked: maskEmail(user.email)
  };
}

/**
 * 로그인
 * @returns {Promise<null|{ kind: 'token', token: string, user: object }|{ kind: 'otp', loginChallengeId: string, expiresInSeconds: number, emailMasked: string }>}
 */
async function login(email, password) {
  try {
    const user = await validateCredentials(email, password);
    if (!user) return null;

    if (!isLoginOtpEnabled()) {
      const { token, user: u } = await issueTokenForUser(user);
      return { kind: 'token', token, user: u };
    }

    // OTP 전역 ON 이어도 AGENT 가 아니면 즉시 JWT (관리자·리드·뷰어 등)
    if (!isAgentRoleUser(user)) {
      const { token, user: u } = await issueTokenForUser(user);
      return { kind: 'token', token, user: u };
    }

    if (!loginOtpMail.isSmtpConfigured()) {
      const err = new Error('SMTP not configured');
      err.code = 'SMTP_NOT_CONFIGURED';
      throw err;
    }

    const otpPayload = await createLoginOtpChallengeAndSend(user);
    return { kind: 'otp', ...otpPayload };
  } catch (error) {
    logger.error('Error in login service', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      email
    });
    throw error;
  }
}

/**
 * OTP 검증 후 JWT 발급
 * @returns {Promise<{ token: string, user: object }|null>}
 */
async function verifyLoginOtp(loginChallengeId, code) {
  const id = String(loginChallengeId || '').trim();
  const codeStr = String(code || '').trim();
  if (!id || !codeStr) return null;

  const row = queryOne('SELECT * FROM LoginOtpChallenge WHERE id = ?', [id]);
  if (!row) {
    logger.debug('LoginOtpChallenge not found', { id });
    return null;
  }

  if (new Date(row.expiresAt) < new Date()) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    return null;
  }

  if (row.attemptCount >= MAX_OTP_ATTEMPTS) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    return null;
  }

  const expectedHash = hashOtpCode(codeStr);
  const match = timingSafeEqualString(expectedHash, row.codeHash);

  if (!match) {
    execute(
      'UPDATE LoginOtpChallenge SET attemptCount = attemptCount + 1 WHERE id = ?',
      [id]
    );
    return null;
  }

  const user = queryOne('SELECT * FROM User WHERE id = ?', [row.userId]);
  if (!user) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    return null;
  }

  if (!isAgentRoleUser(user)) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    return null;
  }

  execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);

  return issueTokenForUser(user);
}

/**
 * OTP 재전송
 * @returns {Promise<{ expiresInSeconds: number }>}
 */
async function resendLoginOtp(loginChallengeId) {
  const id = String(loginChallengeId || '').trim();
  if (!id) {
    const err = new Error('Invalid challenge');
    err.code = 'CHALLENGE_NOT_FOUND';
    throw err;
  }

  const row = queryOne('SELECT * FROM LoginOtpChallenge WHERE id = ?', [id]);
  if (!row) {
    const err = new Error('Invalid challenge');
    err.code = 'CHALLENGE_NOT_FOUND';
    throw err;
  }

  if (new Date(row.expiresAt) < new Date()) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    const err = new Error('Challenge expired');
    err.code = 'CHALLENGE_EXPIRED';
    throw err;
  }

  const lastSend = row.lastResendAt || row.createdAt;
  const elapsed = Date.now() - new Date(lastSend).getTime();
  if (elapsed < RESEND_COOLDOWN_MS) {
    const err = new Error('Resend cooldown');
    err.code = 'RESEND_COOLDOWN';
    err.retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
    throw err;
  }

  const user = queryOne('SELECT * FROM User WHERE id = ?', [row.userId]);
  if (!user) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    const err = new Error('Invalid challenge');
    err.code = 'CHALLENGE_NOT_FOUND';
    throw err;
  }

  if (!isAgentRoleUser(user)) {
    execute('DELETE FROM LoginOtpChallenge WHERE id = ?', [id]);
    const err = new Error('Invalid challenge');
    err.code = 'CHALLENGE_NOT_FOUND';
    throw err;
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS).toISOString();
  const now = new Date().toISOString();

  execute(
    `UPDATE LoginOtpChallenge SET codeHash = ?, expiresAt = ?, attemptCount = 0, lastResendAt = ? WHERE id = ?`,
    [codeHash, expiresAt, now, id]
  );

  await loginOtpMail.sendLoginOtp(user.email, code);

  return {
    expiresInSeconds: Math.floor(OTP_EXPIRES_MS / 1000)
  };
}

async function getUserById(userId) {
  const id = Number(userId);
  const user = queryOne('SELECT * FROM User WHERE id = ?', [id]);
  return sanitizeUser(user);
}

async function getUserByEmail(email) {
  const user = queryOne('SELECT * FROM User WHERE email = ?', [String(email)]);
  return sanitizeUser(user);
}

async function createUser(data) {
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const now = new Date().toISOString();

  const result = execute(
    `INSERT INTO User (email, name, password, role, createdAt, updatedAt) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      data.email,
      data.name || null,
      hashedPassword,
      data.role || 'AGENT',
      now,
      now
    ]
  );

  const user = queryOne('SELECT * FROM User WHERE id = ?', [result.lastInsertRowid]);
  return sanitizeUser(user);
}

module.exports = {
  isLoginOtpEnabled,
  login,
  verifyLoginOtp,
  resendLoginOtp,
  getUserById,
  getUserByEmail,
  createUser
};
