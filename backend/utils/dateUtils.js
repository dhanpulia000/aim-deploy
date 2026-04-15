/**
 * 한국 시간(Asia/Seoul) 기준 날짜/시간 유틸리티
 * 24시간 모니터링 시스템에서 정확한 시간 처리를 위한 유틸리티 함수
 */

/**
 * Date 객체를 한국 시간 기준 ISO 문자열로 변환
 * @param {Date|string} date - 변환할 날짜 (Date 객체 또는 ISO 문자열)
 * @returns {string} 한국 시간 기준 ISO 문자열
 * 
 * 이 함수는 입력된 날짜를 한국 시간대로 해석하여 ISO 문자열로 반환합니다.
 * 입력된 날짜가 한국 시간 기준이라면, 그 한국 시간을 UTC로 변환한 ISO 문자열을 반환합니다.
 * 
 * 예: 
 * - 입력: 한국 시간 2025-12-23 09:30:00 (Date 객체)
 * - 출력: "2025-12-23T00:30:00.000Z" (UTC로 변환)
 */
function toKSTISOString(date) {
  if (!date) return null;
  
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return null;
  
  // 입력된 날짜를 한국 시간대로 해석하여 날짜/시간 정보 추출
  const kstParts = dateObj.toLocaleString('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // "MM/DD/YYYY, HH:MM:SS" 형식을 파싱
  const [datePart, timePart] = kstParts.split(', ');
  const [month, day, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  
  // 한국 시간을 UTC로 변환 (한국 시간 - 9시간 = UTC)
  // 한국 시간 2025-12-23 09:30:00 → UTC 2025-12-23 00:30:00
  const kstHour = parseInt(hour);
  const kstMinute = parseInt(minute);
  const kstSecond = parseInt(second);
  
  // UTC 시간 계산
  let utcHour = kstHour - 9;
  let utcDay = parseInt(day);
  let utcMonth = parseInt(month);
  let utcYear = parseInt(year);
  
  // 시간이 음수가 되면 하루 전으로 조정
  if (utcHour < 0) {
    utcHour += 24;
    utcDay -= 1;
    // 날짜가 0 이하가 되면 이전 달로
    if (utcDay <= 0) {
      utcMonth -= 1;
      if (utcMonth <= 0) {
        utcMonth = 12;
        utcYear -= 1;
      }
      // 해당 월의 마지막 날짜 계산
      const lastDay = new Date(utcYear, utcMonth, 0).getDate();
      utcDay = lastDay;
    }
  }
  
  const utcDate = new Date(Date.UTC(utcYear, utcMonth - 1, utcDay, utcHour, kstMinute, kstSecond));
  return utcDate.toISOString();
}

/**
 * Date 객체를 한국 시간 기준 날짜 문자열로 변환 (YYYY-MM-DD)
 * @param {Date|string} date - 변환할 날짜
 * @returns {string} 한국 시간 기준 날짜 문자열 (예: "2025-12-23")
 */
function toKSTDateString(date) {
  if (!date) return null;
  
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) return null;
  
  const kstDateStr = dateObj.toLocaleString('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // "MM/DD/YYYY" 형식을 "YYYY-MM-DD"로 변환
  const [month, day, year] = kstDateStr.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 현재 시간을 한국 시간 기준 ISO 문자열로 반환
 * @returns {string} 한국 시간 기준 ISO 문자열
 */
function nowKSTISOString() {
  return toKSTISOString(new Date());
}

/**
 * 현재 시간을 한국 시간 기준 날짜 문자열로 반환 (YYYY-MM-DD)
 * @returns {string} 한국 시간 기준 날짜 문자열
 */
function nowKSTDateString() {
  return toKSTDateString(new Date());
}

/**
 * 한국 시간 기준 Date 객체 생성
 * @param {number} year - 년도
 * @param {number} month - 월 (1-12)
 * @param {number} day - 일
 * @param {number} hour - 시 (0-23, 선택)
 * @param {number} minute - 분 (0-59, 선택)
 * @param {number} second - 초 (0-59, 선택)
 * @returns {Date} 한국 시간 기준 Date 객체 (UTC로 저장되지만 한국 시간 값)
 * 
 * 예: 한국 시간 2025-12-23 09:30 → UTC 2025-12-23 00:30
 */
function createKSTDate(year, month, day, hour = 0, minute = 0, second = 0) {
  // 한국 시간을 UTC로 변환 (한국 시간 - 9시간 = UTC)
  // 한국 시간 2025-12-23 09:30 → UTC 2025-12-23 00:30
  let utcHour = hour - 9;
  let utcDay = day;
  let utcMonth = month;
  let utcYear = year;
  
  // 시간이 음수가 되면 하루 전으로 조정
  if (utcHour < 0) {
    utcHour += 24;
    utcDay -= 1;
    // 날짜가 0 이하가 되면 이전 달로
    if (utcDay <= 0) {
      utcMonth -= 1;
      if (utcMonth <= 0) {
        utcMonth = 12;
        utcYear -= 1;
      }
      // 해당 월의 마지막 날짜 계산
      const lastDay = new Date(utcYear, utcMonth, 0).getDate();
      utcDay = lastDay;
    }
  }
  
  // UTC 시간으로 Date 객체 생성
  return new Date(Date.UTC(utcYear, utcMonth - 1, utcDay, utcHour, minute, second));
}

/**
 * 한국 시간 문자열을 Date 객체로 파싱
 * @param {string} dateStr - 날짜 문자열 (예: "2025-12-23 09:30:00" 또는 "2025-12-23")
 * @returns {Date|null} 파싱된 Date 객체 또는 null
 */
function parseKSTDate(dateStr) {
  if (!dateStr) return null;
  
  // "YYYY-MM-DD HH:MM:SS" 형식
  const dateTimeMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (dateTimeMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = dateTimeMatch;
    return createKSTDate(
      parseInt(year),
      parseInt(month),
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    );
  }
  
  // 기타 형식은 기본 Date 파싱 시도
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * 두 날짜 간의 차이를 초 단위로 계산 (한국 시간 기준)
 * @param {Date|string} date1 - 첫 번째 날짜
 * @param {Date|string} date2 - 두 번째 날짜
 * @returns {number} 차이 (초 단위, date2 - date1)
 */
function diffInSeconds(date1, date2) {
  const d1 = date1 instanceof Date ? date1 : new Date(date1);
  const d2 = date2 instanceof Date ? date2 : new Date(date2);
  
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
  
  return Math.floor((d2.getTime() - d1.getTime()) / 1000);
}

/**
 * UTC 순간(ISO 문자열 등)을 한국 시간 벽시계로 표시 (Discourse API 등)
 * @param {Date|string|number} dateOrIso
 * @returns {string} 예: 2026-04-13 23:15:08 KST (파싱 실패 시 원문 반환)
 */
function formatInstantAsKstWallClock(dateOrIso) {
  if (dateOrIso == null || dateOrIso === '') return '';
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(d.getTime())) return String(dateOrIso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d);
  const p = (t) => parts.find((x) => x.type === t)?.value ?? '';
  const y = p('year');
  const mo = p('month');
  const da = p('day');
  const h = p('hour');
  const mi = p('minute');
  const s = p('second');
  return `${y}-${mo}-${da} ${h}:${mi}:${s} KST`;
}

module.exports = {
  toKSTISOString,
  toKSTDateString,
  nowKSTISOString,
  nowKSTDateString,
  createKSTDate,
  parseKSTDate,
  diffInSeconds,
  formatInstantAsKstWallClock
};

