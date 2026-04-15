/**
 * 클랜 워커 타깃 MonitoredBoard id — getClanWorkerTargetMonitoredBoardIds().
 * 일반 naverCafe·naverCafeBackfill 워커는 동일 함수로 제외해 이중 스캔을 막음.
 * getClanDedicatedMonitoredBoardIds()는 env/설정 명시 id만(이슈 SQL 보조 분기에도 사용).
 */
const { queryOne, query } = require('../libs/db');
const { getClanCompatibleCafeGameCodes } = require('../services/crawlerGames.service');

function getClanDedicatedMonitoredBoardIds() {
  const envIdsRaw = process.env.NAVER_CAFE_CLAN_BOARD_IDS;
  const clanBoardIdsConfig = queryOne('SELECT value FROM MonitoringConfig WHERE key = ?', [
    'naver.clanBoardIds'
  ]);
  const idSource =
    envIdsRaw && String(envIdsRaw).trim()
      ? String(envIdsRaw)
      : clanBoardIdsConfig?.value && String(clanBoardIdsConfig.value).trim()
        ? String(clanBoardIdsConfig.value)
        : '';
  if (!idSource) return [];
  return idSource
    .split(/[,;\s]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
}

const CLAN_NAME_SQL = `(
     name LIKE '%클랜/방송/디스코드%' OR name LIKE '%클랜방송디스코드%'
     OR IFNULL(label, '') LIKE '%클랜/방송/디스코드%' OR IFNULL(label, '') LIKE '%클랜방송디스코드%'
   )`;

/**
 * naverCafeClan.worker·API가 동일하게 쓰는 클랜 워커 타깃 MonitoredBoard id.
 * 1) 이름/라벨이 클랜/방송/디스코드인 활성 PC 보드가 있으면 그것만 (부모·공식 카페 행보다 우선).
 * 2) 없을 때만 NAVER_CAFE_CLAN_BOARD_IDS·naver.clanBoardIds(부모판만 등록된 경우).
 */
function getClanWorkerTargetMonitoredBoardIds() {
  const clanCodes = getClanCompatibleCafeGameCodes();
  const codePh = clanCodes.map(() => '?').join(',');
  const patternRows = query(
    `SELECT id FROM MonitoredBoard 
     WHERE isActive = 1 AND enabled = 1 AND cafeGame IN (${codePh}) AND ${CLAN_NAME_SQL}
     ORDER BY createdAt ASC`,
    clanCodes
  );
  const fromPattern = (patternRows || []).map((r) => Number(r.id));
  if (fromPattern.length > 0) {
    return fromPattern;
  }

  const explicitIds = getClanDedicatedMonitoredBoardIds();
  if (explicitIds.length > 0) {
    const placeholders = explicitIds.map(() => '?').join(',');
    const rows = query(
      `SELECT id FROM MonitoredBoard 
       WHERE isActive = 1 AND enabled = 1 AND cafeGame IN (${codePh}) AND id IN (${placeholders})
       ORDER BY createdAt ASC`,
      [...clanCodes, ...explicitIds]
    );
    return (rows || []).map((r) => Number(r.id));
  }
  return [];
}

module.exports = { getClanDedicatedMonitoredBoardIds, getClanWorkerTargetMonitoredBoardIds };
