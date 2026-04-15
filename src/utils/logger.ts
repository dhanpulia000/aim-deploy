/**
 * Frontend logger utility
 * Only logs in development environment
 */

// 환경 변수 안전하게 접근
const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env[key];
  }
  return undefined;
};

const isDevelopment = getEnvVar('DEV') === 'true' || getEnvVar('MODE') === 'development';
/** true일 때만 debug/info 로그 (대용량 JSON.stringify로 메인 스레드가 멈추는 것 방지) */
const verboseLogs = getEnvVar('VITE_VERBOSE_LOGS') === 'true';

interface LogMeta {
  [key: string]: any;
}

function formatLog(level: string, message: string, meta?: LogMeta): void {
  if (!isDevelopment) {
    return; // Don't log in production
  }

  if ((level === 'debug' || level === 'info') && !verboseLogs) {
    return;
  }

  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level: level.toUpperCase(),
    message,
    ...meta
  };

  switch (level) {
    case 'error':
      console.error(JSON.stringify(logEntry, null, 2));
      break;
    case 'warn':
      console.warn(JSON.stringify(logEntry, null, 2));
      break;
    case 'debug':
      console.debug(JSON.stringify(logEntry, null, 2));
      break;
    default:
      console.log(JSON.stringify(logEntry, null, 2));
  }
}

export const logger = {
  info: (message: string, meta?: LogMeta) => formatLog('info', message, meta),
  error: (message: string, meta?: LogMeta) => formatLog('error', message, meta),
  warn: (message: string, meta?: LogMeta) => formatLog('warn', message, meta),
  debug: (message: string, meta?: LogMeta) => formatLog('debug', message, meta),
  log: (message: string, meta?: LogMeta) => formatLog('info', message, meta),
};




