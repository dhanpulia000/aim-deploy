/**
 * 워커 수집 성공/실패 통계 (메모리 저장)
 * - 워커가 수집 완료 시 POST /api/worker-stats로 보고하면 누적
 * - GET /api/worker-stats로 성공률·비율 조회
 */

const logger = require('../utils/logger');

// workerName -> { lastRun: { success, fail, at }, accumulated: { success, fail } }
const store = new Map();

/**
 * 워커 한 번의 실행 결과 기록 (누적 + 최근 실행 갱신)
 * @param {string} workerName - 워커 이름 (naverCafe, naverCafeBackfill, naverCafeClan 등)
 * @param {number} success - 성공 수 (예: 성공한 게시판 수)
 * @param {number} fail - 실패 수
 * @param {Object} [detail] - 선택적 상세 (saved, errors 등)
 */
function recordRun(workerName, success = 0, fail = 0, detail = {}) {
  if (!workerName || typeof workerName !== 'string') return;
  const s = Number(success) || 0;
  const f = Number(fail) || 0;
  const at = new Date().toISOString();

  let entry = store.get(workerName);
  if (!entry) {
    entry = { lastRun: { success: 0, fail: 0, at: null }, accumulated: { success: 0, fail: 0 }, detail: {} };
    store.set(workerName, entry);
  }

  entry.lastRun = { success: s, fail: f, at, ...detail };
  entry.accumulated.success += s;
  entry.accumulated.fail += f;
  entry.detail = { ...entry.detail, ...detail };

  logger.debug('[WorkerStats] Recorded', { workerName, success: s, fail: f });
}

/**
 * 전체 통계 조회 (성공률 포함)
 * @returns {Object} { workers: { [workerName]: { lastRun, accumulated, successRate } } }
 */
function getStats() {
  const workers = {};
  for (const [name, entry] of store.entries()) {
    const acc = entry.accumulated;
    const total = acc.success + acc.fail;
    const successRate = total > 0 ? Math.round((acc.success / total) * 100) : null;
    const lastRun = entry.lastRun;
    const lastRunTotal = (lastRun.success || 0) + (lastRun.fail || 0);
    const lastRunSuccessRate = lastRunTotal > 0 ? Math.round((lastRun.success / lastRunTotal) * 100) : null;

    workers[name] = {
      lastRun: {
        success: lastRun.success,
        fail: lastRun.fail,
        at: lastRun.at,
        successRate: lastRunSuccessRate
      },
      accumulated: {
        success: acc.success,
        fail: acc.fail,
        total,
        successRate
      },
      detail: entry.detail
    };
  }
  return { workers };
}

/**
 * 통계 초기화 (테스트/디버그용)
 */
function reset() {
  store.clear();
  logger.debug('[WorkerStats] Reset');
}

module.exports = {
  recordRun,
  getStats,
  reset
};
