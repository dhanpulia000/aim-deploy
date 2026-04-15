/**
 * Environment variable validation utility
 * Validates required environment variables on server startup
 */

const logger = require('./logger');

/**
 * Required environment variables
 * Add more as needed
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET'
];

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_ENV_VARS = {
  NODE_ENV: 'development',
  // 원본 프로젝트(8080/5173)와 동시 운영 시 충돌 방지 — AIMGLOBAL 기본값
  PORT: '9080',
  WS_PORT: '9081',
  JWT_EXPIRES_IN: '7d'
};

/**
 * Validate environment variables
 * @throws {Error} If required environment variables are missing
 */
function validateEnv() {
  const missing = [];
  const warnings = [];

  // Check required variables
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check for production-specific warnings
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sqlite')) {
      warnings.push('SQLite is being used in production. Consider using PostgreSQL.');
    }
  }

  // 프로덕션: JWT_SECRET 기본값/미설정 시 기동 거부
  if (process.env.NODE_ENV === 'production' &&
      (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).trim() === '' ||
       process.env.JWT_SECRET === 'DEV_SECRET_CHANGE_IN_PRODUCTION')) {
    console.error('\n❌ JWT_SECRET must be set to a secure value in production.\n');
    logger.error('[EnvValidation] JWT_SECRET invalid for production');
    process.exit(1);
  }

  // Log warnings
  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn(`[EnvValidation] ${warning}`);
    }
  }

  // Throw error if required variables are missing
  if (missing.length > 0) {
    // 개발 환경에서는 기본값 사용 허용
    if (process.env.NODE_ENV !== 'production') {
      logger.warn('[EnvValidation] Missing required environment variables, using defaults for development', { missing });
      
      // 개발 환경 기본값 설정
      if (missing.includes('DATABASE_URL')) {
        process.env.DATABASE_URL =
          'postgresql://127.0.0.1:5432/aimglobal?schema=public';
        logger.warn(
          '[EnvValidation] DATABASE_URL 미설정 — PostgreSQL 기본값을 사용합니다. backend/.env 에 실제 접속 정보를 넣으세요.'
        );
      }
      if (missing.includes('JWT_SECRET')) {
        process.env.JWT_SECRET = 'DEV_SECRET_CHANGE_IN_PRODUCTION';
        logger.warn('[EnvValidation] Using default JWT_SECRET for development (NOT SECURE FOR PRODUCTION!)');
      }
    } else {
      // 프로덕션 환경에서는 필수
      const errorMessage = `Missing required environment variables: ${missing.join(', ')}\n\n` +
        `Please set these variables in your .env file or environment.\n` +
        `Required variables:\n${REQUIRED_ENV_VARS.map(v => `  - ${v}`).join('\n')}`;
      
      logger.error('[EnvValidation] Environment validation failed', { missing });
      console.error('\n❌ Environment Validation Failed\n');
      console.error(errorMessage);
      console.error('\n');
      
      process.exit(1);
    }
  }

  // Set defaults for optional variables
  for (const [varName, defaultValue] of Object.entries(OPTIONAL_ENV_VARS)) {
    if (!process.env[varName]) {
      process.env[varName] = defaultValue;
      logger.debug(`[EnvValidation] Using default value for ${varName}: ${defaultValue}`);
    }
  }

  // 선택적 API 키 미설정 시 경고 (기능 비활성화 안내만, 프로세스 종료하지 않음)
  const OPTIONAL_WARN_IF_MISSING = {
    OPENAI_API_KEY: 'AI 분류 비활성화',
    SLACK_BOT_TOKEN: 'Slack 연동 비활성화',
    SLACK_NOTICE_CHANNEL_ID: 'Slack 공지 수집 비활성화',
    DISCORD_BOT_TOKEN: 'Discord 모니터링 비활성화',
    LINE_CHANNEL_ACCESS_TOKEN: 'LINE 알림 비활성화',
    NAVER_CAFE_COOKIE: '네이버 카페 로그인 필요 글 수집 제한'
  };
  for (const [varName, feature] of Object.entries(OPTIONAL_WARN_IF_MISSING)) {
    if (!process.env[varName] || String(process.env[varName]).trim() === '') {
      logger.warn(`[EnvValidation] ${varName} not set - ${feature}`);
    }
  }

  logger.info('[EnvValidation] Environment validation passed', {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    wsPort: process.env.WS_PORT
  });
}

/**
 * Get environment variable with validation
 * @param {string} varName - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @param {boolean} required - Whether the variable is required
 * @returns {string} Environment variable value
 * @throws {Error} If required variable is missing
 */
function getEnv(varName, defaultValue = null, required = false) {
  const value = process.env[varName];
  
  if (!value && required) {
    throw new Error(`Required environment variable ${varName} is not set`);
  }
  
  return value || defaultValue;
}

module.exports = {
  validateEnv,
  getEnv,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS
};

