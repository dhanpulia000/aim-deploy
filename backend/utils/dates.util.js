// 날짜 관련 유틸리티 함수들

/**
 * 현재 날짜를 YYYY-MM-DD 형식으로 반환
 * @returns {string} 현재 날짜 문자열
 */
function getCurrentDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * 주간 보고서용 날짜 범위 계산
 * @param {Date} date - 기준 날짜
 * @returns {Object} 주간 시작일과 종료일
 */
function getWeekRange(date = new Date()) {
  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // 월요일 시작
  startOfWeek.setDate(diff);
  
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  
  return {
    start: startOfWeek.toISOString().split('T')[0],
    end: endOfWeek.toISOString().split('T')[0]
  };
}

/**
 * 월간 보고서용 날짜 범위 계산
 * @param {Date} date - 기준 날짜
 * @returns {Object} 월간 시작일과 종료일
 */
function getMonthRange(date = new Date()) {
  const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  
  return {
    start: startOfMonth.toISOString().split('T')[0],
    end: endOfMonth.toISOString().split('T')[0]
  };
}

/**
 * 날짜 문자열을 Date 객체로 변환
 * @param {string} dateString - 날짜 문자열
 * @returns {Date} Date 객체
 */
function parseDateString(dateString) {
  if (!dateString) return null;
  
  // 다양한 형식 지원
  const formats = [
    /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
    /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
    /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
    /^\d{2}-\d{2}-\d{4}$/ // MM-DD-YYYY
  ];
  
  for (const format of formats) {
    if (format.test(dateString)) {
      return new Date(dateString);
    }
  }
  
  return new Date(dateString);
}

/**
 * 두 날짜 사이의 일수 계산
 * @param {Date|string} startDate - 시작 날짜
 * @param {Date|string} endDate - 종료 날짜
 * @returns {number} 일수 차이
 */
function getDaysDifference(startDate, endDate) {
  const start = typeof startDate === 'string' ? parseDateString(startDate) : startDate;
  const end = typeof endDate === 'string' ? parseDateString(endDate) : endDate;
  
  if (!start || !end) return 0;
  
  const diffTime = Math.abs(end - start);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * 날짜를 한국어 형식으로 포맷
 * @param {Date|string} date - 날짜
 * @returns {string} 한국어 형식 날짜 문자열
 */
function formatKoreanDate(date) {
  const d = typeof date === 'string' ? parseDateString(date) : date;
  if (!d) return '';
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  
  return `${year}년 ${month}월 ${day}일`;
}

module.exports = {
  getCurrentDateString,
  getWeekRange,
  getMonthRange,
  parseDateString,
  getDaysDifference,
  formatKoreanDate
};

