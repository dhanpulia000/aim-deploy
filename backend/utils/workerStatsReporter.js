/**
 * 워커 프로세스에서 수집 성공/실패를 서버에 보고하는 유틸
 * - 워커는 별도 프로세스이므로 HTTP로 POST
 * - 실패해도 워커 동작에는 영향 없음 (무시)
 */

const port = Number(process.env.PORT) || 9080;
const baseUrl = process.env.API_BASE_URL || `http://127.0.0.1:${port}`;

/**
 * 워커 수집 결과 보고 (비동기, 에러 시 무시)
 * @param {string} workerName - naverCafe, naverCafeBackfill, naverCafeClan 등
 * @param {number} success - 성공 수
 * @param {number} fail - 실패 수
 * @param {Object} [detail] - 선택적 상세 (saved, totalSaved 등)
 */
function reportWorkerStats(workerName, success = 0, fail = 0, detail = {}) {
  const url = `${baseUrl}/api/worker-stats`;
  const body = JSON.stringify({
    workerName,
    success: Number(success) || 0,
    fail: Number(fail) || 0,
    ...detail
  });
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }).catch(() => {});
}

module.exports = { reportWorkerStats };
