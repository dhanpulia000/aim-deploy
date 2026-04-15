/**
 * 주간 기간 계산 (월요일 00:00 ~ 일요일 23:59) - 한국 시간 기준
 * @param {Date} date - 기준 날짜 (기본값: 현재 날짜)
 * @returns {Object} { startDate, endDate, weekNumber, year, startDateFormatted, endDateFormatted, monthWeekLabel, yearMonthWeekLabel }
 */
function getWeeklyPeriod(date = new Date()) {
  // 한국 시간으로 변환 (UTC +9)
  const koreaOffset = 9 * 60; // minutes
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const koreaTime = new Date(utc + (koreaOffset * 60000));

  const d = new Date(koreaTime);
  const day = d.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  // 이번 주 월요일 00:00:00 (KST)
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);

  // 이번 주 일요일 23:59:59.999 (KST)
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  // 주차 계산: 연도 첫 번째 월요일 기준
  const year = monday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const jan1MondayOffset = jan1Day === 0 ? -6 : 1 - jan1Day;
  const firstMonday = new Date(year, 0, 1 + jan1MondayOffset);
  firstMonday.setHours(0, 0, 0, 0);

  const daysDiff = Math.floor((monday - firstMonday) / (1000 * 60 * 60 * 24));
  const weekNumber = Math.floor(daysDiff / 7) + 1;

  // UTC로 변환하여 ISO 8601 형식으로 반환
  const mondayUTC = new Date(monday.getTime() - (koreaOffset * 60000));
  const sundayUTC = new Date(sunday.getTime() - (koreaOffset * 60000));

  // n월 n주차 (한국식: 해당 주 월요일이 속한 달 기준, 일자를 7일 단위로 올림)
  const month = monday.getMonth() + 1;
  const dayOfMonth = monday.getDate();
  const weekOfMonth = Math.ceil(dayOfMonth / 7);
  const monthWeekLabel = `${month}월 ${weekOfMonth}주차`;
  const yearMonthWeekLabel = `${year}년 ${month}월 ${weekOfMonth}주차`;

  return {
    startDate: mondayUTC.toISOString(),
    endDate: sundayUTC.toISOString(),
    startDateFormatted: `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`,
    endDateFormatted: `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`,
    weekNumber,
    year,
    monthWeekLabel,
    yearMonthWeekLabel
  };
}

/**
 * 주차 라벨 (n월 n주차) 반환
 * @param {Object} period - getWeeklyPeriod 반환값
 * @returns {string} 예: "1월 3주차"
 */
function getMonthWeekLabel(period) {
  return period && period.monthWeekLabel ? period.monthWeekLabel : '';
}

module.exports = {
  getWeeklyPeriod,
  getMonthWeekLabel
};

