/**
 * PUBG PC / Mobile / 클랜 / 카드 교환 유입 이슈 집계 (이슈 생성 시각 createdAt, KST 기준)
 * 클랜 정의는 issues.service.js getClanIssues 과 동일한 규칙을 축약 반영
 * 카드 교환 정의는 issues.service.js getCardExchangeIssues 와 동일
 */
const { query } = require('../libs/db');
const { queryOne } = require('../libs/db');
const logger = require('../utils/logger');
const crawlerGames = require('./crawlerGames.service');

const CLAN_TAGGED_ARTICLE_IDS_SUBQUERY = `
SELECT r.articleId FROM RawLog r
WHERE r.source = 'naver'
  AND json_extract(r.metadata, '$.naverCollection') = 'clan'
  AND r.articleId IS NOT NULL AND TRIM(CAST(r.articleId AS TEXT)) != ''
UNION
SELECT CAST(json_extract(r.metadata, '$.externalPostId') AS TEXT) FROM RawLog r
WHERE r.source = 'naver'
  AND json_extract(r.metadata, '$.naverCollection') = 'clan'
  AND json_extract(r.metadata, '$.externalPostId') IS NOT NULL
  AND TRIM(CAST(json_extract(r.metadata, '$.externalPostId') AS TEXT)) != ''
`;

function getExplicitClanMonitoredBoardIds() {
  const envIdsRaw = process.env.NAVER_CAFE_CLAN_BOARD_IDS;
  const clanBoardIdsConfig = queryOne('SELECT value FROM MonitoringConfig WHERE key = ?', ['naver.clanBoardIds']);
  const idSource =
    envIdsRaw && String(envIdsRaw).trim()
      ? String(envIdsRaw)
      : clanBoardIdsConfig?.value && String(clanBoardIdsConfig.value).trim()
        ? String(clanBoardIdsConfig.value)
        : '';
  if (!idSource) return [];
  return idSource
    .split(/[,;\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
}

function getClanFeMenuIds() {
  const raw = process.env.NAVER_CAFE_CLAN_MENU_IDS || process.env.NAVER_CAFE_CLAN_MENU_ID || '178';
  const ids = String(raw)
    .split(/[,;\s]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  return ids.length > 0 ? ids : [178];
}

function sqlFeMenuMatch(columnRef) {
  const parts = [];
  for (const mid of getClanFeMenuIds()) {
    parts.push(`(${columnRef} LIKE '%menuid=${mid}%')`);
    parts.push(`(${columnRef} LIKE '%/menus/${mid}%')`);
  }
  return parts.join(' OR ');
}

function periodKeyExpr(period) {
  if (period === 'daily') {
    return `DATE(datetime(i.createdAt, '+9 hours'))`;
  }
  if (period === 'weekly') {
    return `(strftime('%G', datetime(i.createdAt, '+9 hours')) || '-W' || strftime('%V', datetime(i.createdAt, '+9 hours')))`;
  }
  if (period === 'monthly') {
    return `strftime('%Y-%m', datetime(i.createdAt, '+9 hours'))`;
  }
  return `DATE(datetime(i.createdAt, '+9 hours'))`;
}

/**
 * 클랜 CASE 표현식 (SUM 내부). 보드 id는 정수만 허용해 SQL에 직접 삽입 —
 * SQLite는 ? 를 문서 순서대로 바인딩하므로 SELECT 안의 ? 가 WHERE 날짜보다 먼저 소비되는 문제를 피함.
 */
function buildClanCaseSum() {
  const explicitIds = getExplicitClanMonitoredBoardIds();
  const feMenu = sqlFeMenuMatch('i.sourceUrl');

  const nameBranch = `(
    mb.name LIKE '%클랜/방송/디스코드%' OR mb.name LIKE '%클랜방송디스코드%'
  )`;

  let explicitBranch = '0';
  if (explicitIds.length > 0) {
    const idList = explicitIds.join(',');
    const { clanSources, baseSources } = crawlerGames.getClanIssueSqlConstants();
    const clanIn = crawlerGames.sqlQuoteList(clanSources);
    const baseIn = crawlerGames.sqlQuoteList(baseSources);
    explicitBranch = `(
      mb.id IN (${idList}) AND (
        i.externalSource IN (${clanIn})
        OR (
          i.externalPostId IS NOT NULL AND TRIM(i.externalPostId) != ''
          AND i.externalPostId IN (${CLAN_TAGGED_ARTICLE_IDS_SUBQUERY})
        )
        OR (
          i.externalSource IN (${baseIn})
          AND i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != ''
          AND (${feMenu})
        )
      )
    )`;
  }

  const codes = crawlerGames.getClanCompatibleCafeGameCodes();
  const codeIn = crawlerGames.sqlQuoteList(codes);
  return `CASE WHEN mb.cafeGame IN (${codeIn}) AND (${nameBranch} OR ${explicitBranch}) THEN 1 ELSE 0 END`;
}

function getCardExchangeFeMenuIdsForVolume() {
  const raw =
    process.env.NAVER_CAFE_CARD_EXCHANGE_MENU_IDS ||
    process.env.NAVER_CAFE_CARD_EXCHANGE_MENU_ID ||
    '230';
  const ids = String(raw)
    .split(/[,;\s]+/)
    .map((s) => parseInt(String(s).trim(), 10))
    .filter((n) => !Number.isNaN(n) && n > 0);
  return ids.length > 0 ? ids : [230];
}

function sqlCardExchangeFeMenuSourceUrlMatch(columnRef) {
  const parts = [];
  for (const mid of getCardExchangeFeMenuIdsForVolume()) {
    parts.push(`(${columnRef} LIKE '%menuid=${mid}%')`);
    parts.push(`(${columnRef} LIKE '%/menus/${mid}%')`);
  }
  return parts.join(' OR ');
}

/** 운영/백필 DB에서 MonitoredBoard row가 비어 있을 때 보강 (쉼표 구분, 예: 8) */
function getCardExchangeBoardIdsFromEnv() {
  const raw = process.env.NAVER_CAFE_CARD_EXCHANGE_BOARD_IDS || '';
  if (!String(raw).trim()) return [];
  return [
    ...new Set(
      String(raw)
        .split(/[,;\s]+/)
        .map((s) => parseInt(String(s).trim(), 10))
        .filter((n) => !Number.isNaN(n) && n > 0)
    )
  ];
}

function normalizeMonitoredBoardIdList(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const id = r && r.id;
    if (id == null) continue;
    const n = typeof id === 'bigint' ? Number(id) : parseInt(String(id), 10);
    if (!Number.isNaN(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
}

function getCardExchangeMonitoredBoardIdsForVolume() {
  const fromEnv = getCardExchangeBoardIdsFromEnv();
  try {
    const mids = getCardExchangeFeMenuIdsForVolume();
    const conditions = [];
    for (const mid of mids) {
      conditions.push(`url LIKE '%/menus/${mid}%'`);
      conditions.push(`url LIKE '%menuid=${mid}%'`);
      conditions.push(`listUrl LIKE '%/menus/${mid}%'`);
      conditions.push(`listUrl LIKE '%menuid=${mid}%'`);
    }
    const where = conditions.length > 0 ? `(${conditions.join(' OR ')})` : '1=0';
    const rows = query(
      // isActive 제외: 비활성 보드로 태깅된 과거 이슈도 집계·관리 화면과 맞춤
      `SELECT id FROM MonitoredBoard WHERE cafeGame = 'PUBG_MOBILE' AND ${where}`,
      []
    );
    const fromDb = normalizeMonitoredBoardIdList(rows);
    return [...new Set([...fromEnv, ...fromDb])].sort((a, b) => a - b);
  } catch {
    return [...fromEnv].sort((a, b) => a - b);
  }
}

/**
 * 카드 교환 1건 여부. SQL 조각 — CASE WHEN 안에 그대로 사용
 * - 보드 id로 태깅된 글: 원문 sourceUrl에 menus/230이 없어도 포함(집계 0건 방지)
 * - 그 외: 모바일 카페 + sourceUrl에 메뉴 흔적
 */
function buildCardExchangeVolumePredicate() {
  const menuMatch = sqlCardExchangeFeMenuSourceUrlMatch('i.sourceUrl');
  const boardIds = getCardExchangeMonitoredBoardIdsForVolume();
  const byBoard =
    boardIds.length > 0 ? `i.monitoredBoardId IN (${boardIds.join(',')})` : '1=0';
  const byUrl = `i.monitoredBoardId IS NOT NULL
    AND mb.cafeGame = 'PUBG_MOBILE'
    AND i.sourceUrl IS NOT NULL AND TRIM(i.sourceUrl) != ''
    AND (${menuMatch})`;
  return `((${byBoard}) OR (${byUrl}))`;
}

/**
 * @param {Object} opts
 * @param {'daily'|'weekly'|'monthly'} opts.period
 * @param {string} opts.startDate YYYY-MM-DD KST 달력 기준 필터(해당 KST일의 유입)
 * @param {string} opts.endDate
 * @param {number|undefined} opts.projectId
 */
function getGameAndClanVolume({ period, startDate, endDate, projectId }) {
  const p = period === 'weekly' || period === 'monthly' ? period : 'daily';
  const periodExpr = periodKeyExpr(p);
  const params = [];
  let where = '1=1';

  if (startDate) {
    where += " AND DATE(datetime(i.createdAt, '+9 hours')) >= DATE(?)";
    params.push(startDate);
  }
  if (endDate) {
    where += " AND DATE(datetime(i.createdAt, '+9 hours')) <= DATE(?)";
    params.push(endDate);
  }
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    const pid = parseInt(String(projectId), 10);
    if (!Number.isNaN(pid)) {
      where += ' AND i.projectId = ?';
      params.push(pid);
    }
  }

  const cardExPred = buildCardExchangeVolumePredicate();
  const cardExchangeCase = `CASE WHEN ${cardExPred} THEN 1 ELSE 0 END`;
  const pubgMobileCase = `CASE WHEN (${cardExPred}) THEN 0 WHEN mb.cafeGame = 'PUBG_MOBILE' OR i.externalSource = 'NAVER_CAFE_PUBG_MOBILE' THEN 1 ELSE 0 END`;
  const pubgPcCase = `CASE WHEN mb.cafeGame = 'PUBG_MOBILE' OR i.externalSource = 'NAVER_CAFE_PUBG_MOBILE' THEN 0
    WHEN mb.cafeGame = 'PUBG_PC' THEN 1
    WHEN i.externalSource IN ('NAVER_CAFE_PUBG_PC', 'NAVER_CAFE_PUBG_PC_CLAN') THEN 1
    WHEN i.externalSource IS NOT NULL AND i.externalSource LIKE 'NAVER_CAFE_PUBG_PC%' AND i.externalSource NOT LIKE '%MOBILE%' THEN 1
    ELSE 0 END`;

  const clanCase = buildClanCaseSum();

  const sql = `
    SELECT
      ${periodExpr} AS periodKey,
      SUM(${pubgMobileCase}) AS pubgMobile,
      SUM(${pubgPcCase}) AS pubgPc,
      SUM(${clanCase}) AS clanPosts,
      SUM(${cardExchangeCase}) AS cardExchangePosts
    FROM ReportItemIssue i
    LEFT JOIN MonitoredBoard mb ON i.monitoredBoardId = mb.id
    WHERE ${where}
    GROUP BY ${periodExpr}
    ORDER BY ${periodExpr} ASC
  `;

  logger.debug('[IngestionVolume] query', { period: p, paramCount: params.length });

  try {
    const rows = query(sql, params);
    return rows.map((r) => ({
      period: r.periodKey,
      pubgPc: Number(r.pubgPc) || 0,
      pubgMobile: Number(r.pubgMobile) || 0,
      clanPosts: Number(r.clanPosts) || 0,
      cardExchangePosts: Number(r.cardExchangePosts) || 0
    }));
  } catch (e) {
    logger.error('[IngestionVolume] query failed', { error: e.message, sql: sql.substring(0, 200) });
    throw e;
  }
}

module.exports = {
  getGameAndClanVolume,
  periodKeyExpr
};
