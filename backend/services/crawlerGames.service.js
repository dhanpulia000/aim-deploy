/**
 * 네이버 카페 크롤러 프로필 (MonitoredBoard.cafeGame / MonitoredUrl.cafeGame 값).
 * SystemCode.type = 'CRAWLER_GAME' — code는 저장 값, label은 UI, metadata는 JSON.
 *
 * metadata 예시:
 * {
 *   "externalSource": "NAVER_CAFE_PUBG_PC",
 *   "clanExternalSource": "NAVER_CAFE_PUBG_PC_CLAN",
 *   "naverFlavor": "pc" | "mobile"
 * }
 */

const { query, queryOne } = require('../libs/db');

const TYPE = 'CRAWLER_GAME';

const LEGACY_EXTERNAL = {
  PUBG_PC: 'NAVER_CAFE_PUBG_PC',
  PUBG_MOBILE: 'NAVER_CAFE_PUBG_MOBILE'
};
const LEGACY_CLAN = 'NAVER_CAFE_PUBG_PC_CLAN';

function fallbackCrawlerGamesList() {
  return [
    {
      id: -1,
      code: 'PUBG_PC',
      label: 'PUBG 공식 PC 카페 (naver.com) — 시드 전 폴백',
      displayOrder: 1,
      metadata: {
        externalSource: LEGACY_EXTERNAL.PUBG_PC,
        clanExternalSource: LEGACY_CLAN,
        naverFlavor: 'pc'
      },
      isActive: true
    },
    {
      id: -2,
      code: 'PUBG_MOBILE',
      label: 'PUBG 공식 모바일 카페 (naver.com) — 시드 전 폴백',
      displayOrder: 2,
      metadata: { externalSource: LEGACY_EXTERNAL.PUBG_MOBILE, naverFlavor: 'mobile' },
      isActive: true
    }
  ];
}

function parseMetadata(raw) {
  if (raw == null || raw === '') return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function listActiveCrawlerGames() {
  let rows;
  try {
    rows = query(
      `SELECT id, code, label, displayOrder, metadata, isActive
       FROM SystemCode
       WHERE type = ? AND isActive = 1
       ORDER BY displayOrder ASC, code ASC`,
      [TYPE]
    );
  } catch {
    return fallbackCrawlerGamesList();
  }
  const mapped = (rows || []).map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    displayOrder: r.displayOrder,
    metadata: parseMetadata(r.metadata),
    isActive: Boolean(r.isActive)
  }));
  if (mapped.length > 0) return mapped;
  return fallbackCrawlerGamesList();
}

function getCrawlerGameRow(code) {
  if (!code || typeof code !== 'string') return null;
  try {
    return queryOne(
      `SELECT code, label, metadata FROM SystemCode WHERE type = ? AND code = ? AND isActive = 1`,
      [TYPE, code]
    );
  } catch {
    return null;
  }
}

function isValidCrawlerGameCode(code) {
  if (!code || typeof code !== 'string') return false;
  try {
    const row = queryOne(
      `SELECT 1 AS ok FROM SystemCode WHERE type = ? AND code = ? AND isActive = 1`,
      [TYPE, code]
    );
    if (row) return true;
    const cntRow = queryOne(`SELECT COUNT(*) AS c FROM SystemCode WHERE type = ?`, [TYPE]);
    const n = Number(cntRow?.c) || 0;
    if (n === 0 && (code === 'PUBG_PC' || code === 'PUBG_MOBILE')) return true;
    return false;
  } catch {
    return code === 'PUBG_PC' || code === 'PUBG_MOBILE';
  }
}

/**
 * 네이버 이슈 연동용 externalSource 문자열
 * @param {string} cafeGame
 * @param {boolean} fromClanWorker naverCollection === 'clan'
 */
function resolveNaverExternalSource(cafeGame, fromClanWorker) {
  const game = cafeGame || 'PUBG_PC';
  const row = getCrawlerGameRow(game);
  const meta = row ? parseMetadata(row.metadata) : null;
  const base = meta?.externalSource || LEGACY_EXTERNAL[game] || `NAVER_CAFE_${game}`;
  const clan = meta?.clanExternalSource || (game === 'PUBG_PC' ? LEGACY_CLAN : null);
  if (fromClanWorker && clan) return clan;
  return base;
}

function getClanExternalSourceForGame(cafeGame) {
  const game = cafeGame || 'PUBG_PC';
  const row = getCrawlerGameRow(game);
  const meta = row ? parseMetadata(row.metadata) : null;
  if (meta?.clanExternalSource) return meta.clanExternalSource;
  if (game === 'PUBG_PC') return LEGACY_CLAN;
  return null;
}

/** 클랜 워커·SQL에서 cafeGame IN (...) 에 쓰는 코드 목록 */
function getClanCompatibleCafeGameCodes() {
  let rows;
  try {
    rows = query(`SELECT code, metadata FROM SystemCode WHERE type = ? AND isActive = 1`, [TYPE]);
  } catch {
    return ['PUBG_PC'];
  }
  const out = [];
  for (const r of rows || []) {
    const m = parseMetadata(r.metadata);
    if (m && m.clanExternalSource) out.push(r.code);
  }
  if (out.length === 0) out.push('PUBG_PC');
  return out;
}

/**
 * 클랜 이슈 EXISTS / 집계 SQL용 상수 (params 순서: codes, then explicitIds, clanSources, baseSources)
 */
function getClanIssueSqlConstants() {
  let rows;
  try {
    rows = query(`SELECT code, metadata FROM SystemCode WHERE type = ? AND isActive = 1`, [TYPE]);
  } catch {
    return {
      codes: ['PUBG_PC'],
      clanSources: [LEGACY_CLAN],
      baseSources: [LEGACY_EXTERNAL.PUBG_PC]
    };
  }
  const codes = [];
  const clanSources = [];
  const baseSources = [];
  for (const r of rows || []) {
    const m = parseMetadata(r.metadata);
    if (m && m.clanExternalSource) {
      codes.push(r.code);
      clanSources.push(m.clanExternalSource);
      if (m.externalSource) baseSources.push(m.externalSource);
    }
  }
  if (codes.length === 0) {
    codes.push('PUBG_PC');
    clanSources.push(LEGACY_CLAN);
    baseSources.push(LEGACY_EXTERNAL.PUBG_PC);
  }
  return { codes, clanSources, baseSources };
}

/** 자유게시판 예외(수집 유지): naverFlavor pc 인 프로필 */
function isNaverPcFreeBoardExceptionCafeGame(cafeGame) {
  if (!cafeGame) return false;
  if (cafeGame === 'PUBG_PC') return true;
  const row = getCrawlerGameRow(cafeGame);
  const meta = row ? parseMetadata(row.metadata) : null;
  return meta?.naverFlavor === 'pc';
}

function sqlQuoteList(strs) {
  return strs.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(', ');
}

module.exports = {
  TYPE,
  parseMetadata,
  listActiveCrawlerGames,
  getCrawlerGameRow,
  isValidCrawlerGameCode,
  resolveNaverExternalSource,
  getClanExternalSourceForGame,
  getClanCompatibleCafeGameCodes,
  getClanIssueSqlConstants,
  isNaverPcFreeBoardExceptionCafeGame,
  sqlQuoteList,
  LEGACY_EXTERNAL,
  LEGACY_CLAN
};
