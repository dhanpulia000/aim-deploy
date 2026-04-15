/**
 * LINE API 발송 건수 집계 (앱 기준)
 * - LINE은 사용량 조회용 공식 API를 제공하지 않음. 공식 쿼터는 LINE Official Account Manager(manager.line.biz)에서 확인
 * - 이 서비스는 앱에서 성공적으로 전송한 건수만 월별로 누적하여 노출
 */

const logger = require('../utils/logger');

let currentMonthKey = null; // 'YYYY-MM'
let sentThisMonth = 0;
let lastSentAt = null; // ISO string
/** @type {Record<string, number>} 날짜(YYYY-MM-DD, KST)별 발송 건수. 최근 90일만 유지 */
let sentByDay = {};

const SENT_BY_DAY_RETENTION_DAYS = 90;

function getMonthKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** KST 기준 오늘 날짜 YYYY-MM-DD */
function getTodayKST() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(new Date()).replace(/\//g, '-');
}

function pruneSentByDay() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - SENT_BY_DAY_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const date of Object.keys(sentByDay)) {
    if (date < cutoffStr) delete sentByDay[date];
  }
}

/**
 * 발송 성공 시 기록 (line.service.sendMessage 성공 후, LINE API 200 OK일 때만 호출됨)
 * 1회 API push = 1건으로 집계 (실제 "몇 번 보냈는지"와 일치하도록)
 * @param {number} sendCount - 발송 횟수 (기본 1, API 호출 1회당 1)
 */
function recordSend(sendCount = 1) {
  const key = getMonthKey();
  if (key !== currentMonthKey) {
    currentMonthKey = key;
    sentThisMonth = 0;
  }
  const count = Math.max(1, Math.floor(Number(sendCount) || 1));
  sentThisMonth += count;
  lastSentAt = new Date().toISOString();

  const todayKST = getTodayKST();
  sentByDay[todayKST] = (sentByDay[todayKST] || 0) + count;
  pruneSentByDay();

  logger.debug('[LineUsage] Recorded send', { sendCount: count, sentThisMonth, lastSentAt, date: todayKST });
}

/**
 * 사용량 조회
 * @returns {{ thisMonthSent: number, lastSentAt: string|null, sentByDay: Record<string, number>, note: string }}
 */
function getUsage() {
  const key = getMonthKey();
  if (key !== currentMonthKey) {
    currentMonthKey = key;
    sentThisMonth = 0;
  }
  return {
    thisMonthSent: sentThisMonth,
    lastSentAt: lastSentAt || null,
    sentByDay: { ...sentByDay },
    note: '발송 횟수는 LINE API push 호출 1회당 1건입니다. 공식 쿼터·월간 한도는 LINE Official Account Manager(https://manager.line.biz)에서 확인하세요.'
  };
}

module.exports = {
  recordSend,
  getUsage
};
