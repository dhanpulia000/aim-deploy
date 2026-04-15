/**
 * 주간보고서 「주간(자동)」: Asia/Seoul 달력 기준
 * - 보고 대상 주 = 직전에 끝난 완전한 한 주(월요일~일요일)
 * - "오늘"도 항상 한국시간 날짜로 판단
 */

/**
 * @param {Date} [d]
 * @returns {string} YYYY-MM-DD (Asia/Seoul 달력)
 */
function kstYmd(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/**
 * @param {string} ymd YYYY-MM-DD (Seoul 달력)
 * @param {number} deltaDays
 * @returns {string} YYYY-MM-DD
 */
function addDaysKst(ymd, deltaDays) {
  const t = new Date(`${ymd}T12:00:00+09:00`).getTime() + deltaDays * 86400000;
  return new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/**
 * 해당 KST 날짜가 속한 주의 월요일 (월~일 주간, 월요일 시작)
 * @param {string} ymd YYYY-MM-DD
 */
function mondayOfKstWeekContaining(ymd) {
  const d = new Date(`${ymd}T12:00:00+09:00`);
  const wd = d.getUTCDay();
  const delta = wd === 0 ? -6 : 1 - wd;
  return addDaysKst(ymd, delta);
}

/**
 * 한국시간 "오늘"이 속한 주의 바로 이전 주 = 월요일~일요일 (완료된 지난주)
 * @returns {{ start: string, end: string }}
 */
function getLastCompletedKstWeekMonSun() {
  const todayKst = kstYmd(new Date());
  const thisWeekMonday = mondayOfKstWeekContaining(todayKst);
  const lastMonday = addDaysKst(thisWeekMonday, -7);
  const lastSunday = addDaysKst(lastMonday, 6);
  return { start: lastMonday, end: lastSunday };
}

/**
 * 이번 보고 주(월 시작일)의 직전 주 월~일
 * @param {string} thisWeekMondayYmd - 보고 주간의 월요일 YYYY-MM-DD
 */
function getPreviousKstWeekMonSun(thisWeekMondayYmd) {
  const prevMonday = addDaysKst(thisWeekMondayYmd, -7);
  const prevSunday = addDaysKst(prevMonday, 6);
  return { start: prevMonday, end: prevSunday };
}

module.exports = {
  kstYmd,
  addDaysKst,
  mondayOfKstWeekContaining,
  getLastCompletedKstWeekMonSun,
  getPreviousKstWeekMonSun
};
