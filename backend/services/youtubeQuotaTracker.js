// YouTube Data API v3 할당량 추적 서비스
const logger = require('../utils/logger');

// 일일 할당량 (기본값: 10,000 units)
const DEFAULT_DAILY_QUOTA = 10000;

// 할당량 사용량 추적 (메모리 기반)
// 구조: { date: 'YYYY-MM-DD', used: number, lastReset: Date }
let quotaUsage = {
  date: null,
  used: 0,
  lastReset: null
};

/**
 * UTC 기준 오늘 날짜 문자열 반환 (YYYY-MM-DD)
 * @returns {string}
 */
function getTodayUTC() {
  const now = new Date();
  const utcDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
  return utcDate.toISOString().split('T')[0];
}

/**
 * 할당량 리셋 확인 및 필요시 리셋
 */
function checkAndResetQuota() {
  const today = getTodayUTC();
  
  // 날짜가 바뀌었거나 초기화되지 않은 경우 리셋
  if (quotaUsage.date !== today) {
    const previousUsed = quotaUsage.used;
    quotaUsage = {
      date: today,
      used: 0,
      lastReset: new Date()
    };
    
    if (previousUsed > 0) {
      logger.info('YouTube API quota reset', { 
        previousDate: quotaUsage.date, 
        previousUsed,
        newDate: today 
      });
    }
  }
}

/**
 * 할당량 사용량 기록
 * @param {number} units - 사용한 할당량 단위
 */
function recordQuotaUsage(units) {
  checkAndResetQuota();
  quotaUsage.used += units;
  
  logger.debug('YouTube API quota usage recorded', { 
    units, 
    totalUsed: quotaUsage.used,
    remaining: DEFAULT_DAILY_QUOTA - quotaUsage.used
  });
}

/**
 * 현재 할당량 상태 조회
 * @returns {Object} { used, remaining, dailyQuota, resetTime, hoursUntilReset, minutesUntilReset }
 */
function getQuotaStatus() {
  checkAndResetQuota();
  
  const used = quotaUsage.used;
  const remaining = Math.max(0, DEFAULT_DAILY_QUOTA - used);
  
  // UTC 기준 자정까지 남은 시간 계산
  const now = new Date();
  const utcNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
  const utcMidnight = new Date(utcNow);
  utcMidnight.setUTCHours(24, 0, 0, 0);
  
  const msUntilReset = utcMidnight - utcNow;
  const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
  const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));
  
  return {
    used,
    remaining,
    dailyQuota: DEFAULT_DAILY_QUOTA,
    resetTime: utcMidnight.toISOString(),
    hoursUntilReset,
    minutesUntilReset,
    date: quotaUsage.date
  };
}

/**
 * 할당량 사용량 초기화 (테스트용)
 */
function resetQuota() {
  quotaUsage = {
    date: getTodayUTC(),
    used: 0,
    lastReset: new Date()
  };
  logger.info('YouTube API quota manually reset');
}

module.exports = {
  recordQuotaUsage,
  getQuotaStatus,
  resetQuota,
  DEFAULT_DAILY_QUOTA
};


