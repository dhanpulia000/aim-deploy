/**
 * Winston-based logger with daily rotation
 * Logs are stored in logs/ directory with daily rotation
 */

// 운영 로그·일일 로그 파일명(자정) 기준: 한국 시간 (.env 의 TZ 가 있으면 우선)
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Seoul';
}

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// 로그 디렉토리 생성 (프로젝트 루트의 logs/)
const projectRoot = path.resolve(__dirname, '../..');
const logsDir = path.join(projectRoot, 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 커스텀 포맷: [YYYY-MM-DD HH:mm:ss] [LEVEL] 메시지
const customFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  // 메타데이터가 있으면 JSON으로 추가
  const metaStr = Object.keys(meta).length > 0 
    ? ' ' + JSON.stringify(meta) 
    : '';
  
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
});

// 타임스탬프: OS TZ와 무관하게 KST로 표기 (process.env.TZ 와 동일하게 유지)
const logTimeZone = process.env.TZ || 'Asia/Seoul';
const timestampFormat = winston.format.timestamp({
  format: () =>
    new Date().toLocaleString('sv-SE', { timeZone: logTimeZone })
});

// 일일 로테이션 설정
const dailyRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true, // 압축 활성화
  maxSize: '20m', // 파일 크기 제한 (선택사항)
  maxFiles: '14d', // 최대 14일치 보관
  format: winston.format.combine(
    timestampFormat,
    winston.format.errors({ stack: true }),
    customFormat
  )
});

// 에러 로그 전용 일일 로테이션
const errorRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  level: 'error', // error 레벨만 기록
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: winston.format.combine(
    timestampFormat,
    winston.format.errors({ stack: true }),
    customFormat
  )
});

// 콘솔 출력 (개발 환경용)
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    timestampFormat,
    winston.format.colorize(),
    winston.format.errors({ stack: true }),
    customFormat
  ),
  // 프로덕션에서는 콘솔 출력 최소화 (선택사항)
  silent: process.env.NODE_ENV === 'production' && process.env.DISABLE_CONSOLE_LOG === 'true'
});

// Winston 로거 생성
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // 환경 변수로 로그 레벨 제어
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  transports: [
    dailyRotateTransport,
    errorRotateTransport,
    consoleTransport
  ],
  // 예외 처리
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '14d',
      format: winston.format.combine(
        timestampFormat,
        winston.format.errors({ stack: true }),
        customFormat
      )
    })
  ],
  // Promise rejection 처리
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxFiles: '14d',
      format: winston.format.combine(
        timestampFormat,
        winston.format.errors({ stack: true }),
        customFormat
      )
    })
  ]
});

// 기존 API와 호환성을 위한 헬퍼 함수들
const logLevels = {
  INFO: 'info',
  ERROR: 'error',
  WARN: 'warn',
  DEBUG: 'debug'
};

/**
 * Log info message
 * @param {string} message - Log message
 * @param {object} meta - Additional metadata (optional)
 */
function info(message, meta = {}) {
  if (Object.keys(meta).length > 0) {
    logger.info(message, meta);
  } else {
    logger.info(message);
  }
}

/**
 * Log error message
 * @param {string} message - Error message
 * @param {object} meta - Additional metadata (optional)
 */
function error(message, meta = {}) {
  if (Object.keys(meta).length > 0) {
    logger.error(message, meta);
  } else {
    logger.error(message);
  }
}

/**
 * Log warning message
 * @param {string} message - Warning message
 * @param {object} meta - Additional metadata (optional)
 */
function warn(message, meta = {}) {
  if (Object.keys(meta).length > 0) {
    logger.warn(message, meta);
  } else {
    logger.warn(message);
  }
}

/**
 * Log debug message
 * @param {string} message - Debug message
 * @param {object} meta - Additional metadata (optional)
 */
function debug(message, meta = {}) {
  if (Object.keys(meta).length > 0) {
    logger.debug(message, meta);
  } else {
    logger.debug(message);
  }
}

/**
 * Log HTTP request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} duration - Request duration in milliseconds
 * 
 * IMPORTANT: This function must NEVER throw. Always wrapped in try/catch.
 */
function logRequest(req, res, duration) {
  try {
    const method = req.method || 'UNKNOWN';
    const url = req.originalUrl || req.url || 'UNKNOWN';
    const status = res.statusCode || 0;
    const userId = req.user ? req.user.id : null;

    info('HTTP request', {
      method,
      url,
      status,
      duration: `${duration}ms`,
      userId
    });
  } catch (err) {
    // Make absolutely sure this never throws
    error('Failed to log request', { error: err.message });
  }
}

// Winston 로거에 logRequest 메서드 추가
logger.logRequest = logRequest;

module.exports = {
  info,
  error,
  warn,
  debug,
  logRequest,
  logLevels,
  // Winston 로거 인스턴스도 export (필요시 직접 사용 가능)
  winston: logger
};
