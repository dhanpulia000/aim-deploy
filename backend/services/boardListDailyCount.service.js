/**
 * 게시판 목록 페이지를 열어 같은 날짜에 올라온 게시글 수를 집계
 * - 구형 ArticleList: search.viewType·search.listType(50)·search.page 로 페이지네이션
 * - 신규 FE /f-e/cafes/.../menus/N : search.* 를 붙이지 않음(목록 깨짐 방지).
 *   → 현재는 1페이지만 읽음(사이트 기본 15개 전후). 전체글(menus/0)은 카페 전체 피드로 DOM·페이지 규모가 다름.
 * - RawLog 없이 "직접 게시글 수 확인" 방식
 */

const logger = require('../utils/logger');
const { getDatabase, query } = require('../libs/db');

function isBoardListSnapshotDisabled() {
  const v = process.env.BOARD_LIST_DAILY_SNAPSHOT_DISABLE;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/** start..end inclusive (KST calendar days), both YYYY-MM-DD */
function listKstDatesInclusive(startYmd, endYmd) {
  const start = String(startYmd || '').trim();
  const end = String(endYmd || '').trim();
  if (!start || !end || start > end) return [];
  const out = [];
  let cur = start;
  while (out.length < 400) {
    out.push(cur);
    if (cur === end) return out;
    const next = addDaysKST(cur, 1);
    if (!next || next <= cur) return [];
    cur = next;
    if (cur > end) return [];
  }
  return [];
}

/**
 * 기간 내 매일 스냅샷이 있으면 합산 결과 반환, 아니면 null
 * @param {number} minMaxPages 요청 스캔 깊이 — 저장된 maxPagesUsed가 이보다 작으면 DB 미사용(재스캔)
 * @returns {{ listBasedCount: number, listBasedTotalRows: number, listBasedFromDb: true } | null}
 */
function loadListBasedFromDbIfComplete(boardId, startDate, endDate, minMaxPages = 1) {
  if (isBoardListSnapshotDisabled()) return null;
  if (!startDate || !endDate) return null;
  const bid = Number(boardId);
  if (Number.isNaN(bid)) return null;
  const minPages = Math.max(1, Math.floor(Number(minMaxPages)) || 1);
  const days = listKstDatesInclusive(startDate, endDate);
  if (days.length === 0) return null;
  try {
    const db = getDatabase();
    const placeholders = days.map(() => '?').join(',');
    const params = [bid, ...days];
    const stmt = db.prepare(
      `SELECT dateKst, postCount, scanTotalRows, maxPagesUsed FROM BoardListDailySnapshot
       WHERE monitoredBoardId = ? AND dateKst IN (${placeholders})`
    );
    const rows = stmt.all(...params);
    const byDay = new Map(rows.map((r) => [String(r.dateKst), r]));
    for (const d of days) {
      if (!byDay.has(d)) return null;
      const row = byDay.get(d);
      const mp = row.maxPagesUsed != null ? Number(row.maxPagesUsed) : null;
      if (mp == null || Number.isNaN(mp) || mp < minPages) return null;
    }
    let sum = 0;
    let maxScan = 0;
    for (const d of days) {
      const row = byDay.get(d);
      sum += Number(row.postCount) || 0;
      const st = Number(row.scanTotalRows);
      if (!Number.isNaN(st) && st > maxScan) maxScan = st;
    }
    return {
      listBasedCount: sum,
      listBasedTotalRows: maxScan,
      listBasedSkipped: null,
      listBasedError: null,
      listBasedFromDb: true
    };
  } catch (e) {
    logger.warn('[BoardListDailyCount] DB read failed (table missing or SQL error)', {
      error: e.message,
      boardId: bid
    });
    return null;
  }
}

/**
 * 목록 스캔 결과 일별 건수를 DB에 저장(UPSERT)
 * @param {number} boardId
 * @param {{ date: string, count: number }[]} dailyCounts
 * @param {{ scanTotalRows?: number, maxPagesUsed?: number }} meta
 */
function upsertBoardListDailySnapshots(boardId, dailyCounts, meta = {}) {
  if (isBoardListSnapshotDisabled()) return;
  const bid = Number(boardId);
  if (Number.isNaN(bid) || !Array.isArray(dailyCounts) || dailyCounts.length === 0) return;
  const scanTotalRows =
    meta.scanTotalRows != null && !Number.isNaN(Number(meta.scanTotalRows))
      ? Number(meta.scanTotalRows)
      : null;
  const maxPagesUsed =
    meta.maxPagesUsed != null && !Number.isNaN(Number(meta.maxPagesUsed))
      ? Number(meta.maxPagesUsed)
      : null;
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO BoardListDailySnapshot (monitoredBoardId, dateKst, postCount, scanTotalRows, maxPagesUsed, computedAt)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(monitoredBoardId, dateKst) DO UPDATE SET
        postCount = excluded.postCount,
        scanTotalRows = excluded.scanTotalRows,
        maxPagesUsed = excluded.maxPagesUsed,
        computedAt = excluded.computedAt
    `);
    const runAll = db.transaction(() => {
      for (const row of dailyCounts) {
        const ymd = String(row.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        const c = Number(row.count);
        const postCount = Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0;
        stmt.run(bid, ymd, postCount, scanTotalRows, maxPagesUsed);
      }
    });
    runAll();
  } catch (e) {
    logger.warn('[BoardListDailyCount] DB upsert failed', { error: e.message, boardId: bid });
  }
}

/**
 * DB 저장분(BoardListDailySnapshot) 일별 목록 건수 조회 — 기간별 UI 표용
 * @param {{ startDate: string, endDate: string, projectId?: number|null|undefined, boardIds?: number[]|null }} opts
 *        boardIds: null/undefined = 게시판 필터 없음, [] = 결과 없음
 * @returns {{ datesInRange: string[], rows: object[] }}
 */
function getBoardListDailySnapshots(opts = {}) {
  const startDate = String(opts.startDate || '').trim();
  const endDate = String(opts.endDate || '').trim();
  const datesInRange = listKstDatesInclusive(startDate, endDate);

  if (!startDate || !endDate || startDate > endDate) {
    return { datesInRange: [], rows: [] };
  }

  if (Array.isArray(opts.boardIds) && opts.boardIds.length === 0) {
    return { datesInRange, rows: [] };
  }

  let sql = `
    SELECT s.monitoredBoardId, mb.name AS boardName, mb.cafeGame, mb.projectId,
           s.dateKst, s.postCount, s.scanTotalRows, s.maxPagesUsed, s.computedAt
    FROM BoardListDailySnapshot s
    INNER JOIN MonitoredBoard mb ON mb.id = s.monitoredBoardId
    WHERE s.dateKst >= ? AND s.dateKst <= ?
      AND mb.isActive = 1 AND mb.enabled = 1
  `;
  const params = [startDate, endDate];

  const projectId = opts.projectId;
  if (projectId !== undefined && projectId !== null && projectId !== '') {
    sql += ' AND mb.projectId = ?';
    params.push(projectId);
  }

  if (Array.isArray(opts.boardIds) && opts.boardIds.length > 0) {
    const ph = opts.boardIds.map(() => '?').join(',');
    sql += ` AND s.monitoredBoardId IN (${ph})`;
    params.push(...opts.boardIds);
  }

  sql += ' ORDER BY mb.name ASC, mb.id ASC, s.dateKst ASC';

  let rows = [];
  try {
    rows = query(sql, params);
  } catch (e) {
    logger.warn('[BoardListDailyCount] getBoardListDailySnapshots failed', { error: e.message });
  }

  return {
    datesInRange,
    rows: rows.map((r) => ({
      monitoredBoardId: Number(r.monitoredBoardId),
      boardName: r.boardName,
      cafeGame: r.cafeGame,
      projectId: r.projectId,
      dateKst: String(r.dateKst),
      postCount: Number(r.postCount) || 0,
      scanTotalRows: r.scanTotalRows != null ? Number(r.scanTotalRows) : null,
      maxPagesUsed: r.maxPagesUsed != null ? Number(r.maxPagesUsed) : null,
      computedAt: r.computedAt
    }))
  };
}

// 같은 게시판/기간 조합을 반복 조회할 때 Playwright 스캔 비용 절감
const LIST_BASED_CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const listBasedCache = new Map(); // cacheKey -> { expiresAt, value }

function getListBasedCache(key) {
  const hit = listBasedCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    listBasedCache.delete(key);
    return null;
  }
  return hit.value;
}

function setListBasedCache(key, value) {
  listBasedCache.set(key, {
    expiresAt: Date.now() + LIST_BASED_CACHE_TTL_MS,
    value
  });
}

/** 오늘 날짜 문자열 (KST) YYYY-MM-DD */
function todayKST() {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/**
 * FE 메뉴 URL(/f-e/cafes/{clubId}/menus/{menuId})을
 * 구형 ArticleList.nhn URL로 변환(= search.page 기반 페이지네이션이 되는 쪽으로 스캔).
 *
 * @param {string} listUrl
 * @returns {string|null}
 */
function convertFeMenuToArticleList(listUrl) {
  if (!listUrl || typeof listUrl !== 'string') return null;
  const m = String(listUrl).match(/\/f-e\/cafes\/(\d+)\/menus\/(\d+)/);
  if (!m) return null;
  const clubId = m[1];
  const menuId = m[2];
  if (!clubId || menuId === undefined) return null;
  return `https://cafe.naver.com/ArticleList.nhn?search.clubid=${clubId}&search.menuid=${menuId}&search.boardtype=L`;
}

/** 오늘 날짜 문자열 (KST) YYYY-MM-DD */
function extractDateTextsInBrowser() {
  const rows = [];
  let trs = document.querySelectorAll('tbody tr:not(.board-notice)');
  if (trs.length === 0) trs = document.querySelectorAll('#upperArticleList tr:not(.board-notice)');
  for (let i = 0; i < trs.length; i++) {
    const row = trs[i];
    const timeEl = row.querySelector('time[datetime]');
    if (timeEl) {
      const dt = (timeEl.getAttribute('datetime') || '').trim();
      if (dt) {
        rows.push(dt);
        continue;
      }
    }
    const dateCell = row.querySelector('td.td_normal.type_date, td.type_date, td[class*="type_date"]');
    let dateText = dateCell ? (dateCell.textContent || '').trim() : '';
    if (!dateText) dateText = row.querySelector('.date, .article-date, time')?.textContent?.trim() || '';
    rows.push(dateText);
  }
  return rows;
}

/** today YYYY-MM-DD (KST) 기준으로 delta일 전의 YYYY-MM-DD (KST) */
function addDaysKST(ymd, deltaDays) {
  const parts = String(ymd || '').split('-').map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const kstMidnight = new Date(
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00+09:00`
  );
  if (Number.isNaN(kstMidnight.getTime())) return null;
  const shifted = new Date(kstMidnight.getTime() + deltaDays * 86400000);
  return shifted.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/**
 * dateText -> YYYY-MM-DD 파싱 (KST 달력 기준 버킷)
 * - ISO / time[datetime]: "2026-02-25T12:00:00+09:00", "2026-02-25"
 * - "2026.02.25.", "2026. 02. 25" (공백 허용)
 * - "2026.02.25 13:59" (날짜+시간)
 * - "00:27", "9:55" -> 오늘(KST)
 * - "어제", "N일 전"
 */
function parseDateText(dateText, today) {
  if (!dateText || typeof dateText !== 'string') return null;
  const t = dateText.trim();
  if (!t) return null;

  const isoDay = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt\s].*)?$/);
  if (isoDay) {
    return `${isoDay[1]}-${isoDay[2]}-${isoDay[3]}`;
  }

  const spacedDateTime = t.match(
    /^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?:\s+(\d{1,2})[:.](\d{2}))?/
  );
  if (spacedDateTime) {
    const [, y, mo, da] = spacedDateTime;
    return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }

  const timeOnly = t.match(/^(\d{1,2})[:.](\d{2})$/);
  if (timeOnly) return today;

  if (t === '어제' || /^yesterday$/i.test(t)) {
    return addDaysKST(today, -1);
  }
  const daysAgo = t.match(/^(\d+)\s*일\s*전\s*$/);
  if (daysAgo) {
    const n = parseInt(daysAgo[1], 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 366) return addDaysKST(today, -n);
  }
  if (t === '오늘' || /^today$/i.test(t)) return today;

  return null;
}

/**
 * 목록에서 나온 일별 건수 배열을 시작·종료일(포함, YYYY-MM-DD)로 합산. 둘 다 없으면 전부 합산.
 * @param {{ date: string, count: number }[]} dailyCounts
 */
function sumDailyCountsInRange(dailyCounts, startDate, endDate) {
  if (!Array.isArray(dailyCounts)) return 0;
  let sum = 0;
  for (const row of dailyCounts) {
    const date = String(row.date || '');
    const count = Number(row.count) || 0;
    if (startDate && date < String(startDate)) continue;
    if (endDate && date > String(endDate)) continue;
    sum += count;
  }
  return sum;
}

/**
 * 기존 Playwright page로 목록 URL 스캔 (브라우저 재사용용)
 * @returns { Promise<{ dailyCounts: { date: string, count: number }[], totalRows: number }> }
 */
async function fetchDailyCountFromListWithPage(page, listUrl, options = {}) {
  const maxPages = options.maxPages || 10;
  const timeoutMs = options.timeoutMs || 60000;
  const today = todayKST();
  const countByDate = {};
  const startDate = options.startDate ? String(options.startDate) : null;

  page.setDefaultTimeout(timeoutMs);

  let totalRows = 0;
  let pageNum = 1;
  const skipFeConversion = options.skipFeConversion === true;
  const converted = skipFeConversion ? null : convertFeMenuToArticleList(listUrl);
  const scanUrlBase = converted || listUrl;
  const isFeCafeMenuUrl = !converted && /\/f-e\/cafes\/\d+\/menus\/\d+/.test(String(scanUrlBase));

  while (pageNum <= maxPages) {
    let urlToOpen;
    try {
      const url = new URL(scanUrlBase);
      if (isFeCafeMenuUrl) {
        if (pageNum === 1) {
          urlToOpen = url.toString();
        } else {
          // FE(/f-e/cafes/.../menus/N) URL은 기본적으로 페이지네이션 파라미터가 명확하지 않아
          // 우선 몇 가지 후보 파라미터를 넣어 시도하고, 결과가 동일하면 중단한다.
          url.searchParams.set('page', String(pageNum));
          url.searchParams.set('search.page', String(pageNum));
          url.searchParams.set('viewType', url.searchParams.get('viewType') || 'L');
          urlToOpen = url.toString();
        }
      } else {
        url.searchParams.set('search.viewType', 'title');
        url.searchParams.set('search.listType', '50');
        url.searchParams.set('search.page', String(pageNum));
        urlToOpen = url.toString();
      }
    } catch (e) {
      logger.warn('[BoardListDailyCount] URL parse failed, using raw listUrl', { error: e.message });
      urlToOpen = scanUrlBase;
    }

    await page.goto(urlToOpen, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2000);

    let dateTexts;
    let frame = null;
    try {
      frame = await page.frame('cafe_main');
    } catch (_) {}
    if (!frame) {
      try {
        const frames = page.frames();
        frame = frames.find((f) => f.url().includes('cafe_main')) || null;
      } catch (_) {}
    }
    try {
      if (frame) {
        dateTexts = await frame.evaluate(extractDateTextsInBrowser);
      } else {
        dateTexts = await page.evaluate(extractDateTextsInBrowser);
      }
    } catch (e) {
      logger.warn('[BoardListDailyCount] evaluate failed for page', { pageNum, error: e.message });
      dateTexts = [];
    }
    if (!dateTexts || !Array.isArray(dateTexts) || dateTexts.length === 0) break;

    const parsedDates = [];
    dateTexts.forEach((txt) => {
      const date = parseDateText(txt, today);
      if (date) {
        parsedDates.push(date);
        countByDate[date] = (countByDate[date] || 0) + 1;
      }
    });
    // 페이지네이션은 보통 최신 → 과거 순으로 내려가므로,
    // 현재 페이지에서 가장 최신 버킷 날짜가 startDate보다 이미 과거면 다음 페이지들은 더 과거라서 중단한다.
    if (startDate && parsedDates.length > 0) {
      const pageMaxDate = parsedDates.reduce((max, d) => (d > max ? d : max), parsedDates[0]);
      if (pageMaxDate < startDate) break;
    }
    totalRows += dateTexts.length;
    pageNum++;
  }

  const dailyCounts = Object.entries(countByDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date));

  logger.info('[BoardListDailyCount] Fetched from list', {
    listUrl: String(listUrl).substring(0, 80),
    totalRows,
    days: dailyCounts.length
  });
  // FE menus/0 같은 케이스는 ArticleList로 변환 시 DOM 파싱이 비는 경우가 있어
  // totalRows가 0이면 원본 FE URL로 한 번 더 시도한다.
  if (converted && totalRows === 0 && !skipFeConversion) {
    return await fetchDailyCountFromListWithPage(page, listUrl, { ...options, skipFeConversion: true });
  }

  return { dailyCounts, totalRows };
}

/**
 * 게시판 목록 URL로 접속해 50개씩 보며 같은 날짜 게시글 수 집계
 * @param { string } listUrl - 목록 URL (ArticleList.nhn 등)
 * @param { object } options - { maxPages: number (기본 10), timeoutMs: number }
 * @returns { Promise<{ dailyCounts: { date: string, count: number }[], totalRows: number }> }
 */
async function fetchDailyCountFromList(listUrl, options = {}) {
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    return await fetchDailyCountFromListWithPage(page, listUrl, options);
  } catch (err) {
    logger.error('[BoardListDailyCount] fetchDailyCountFromList failed', {
      error: err.message,
      stack: err.stack
    });
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 여러 MonitoredBoard에 대해 브라우저 한 번만 띄우고 순차 목록 집계 (통계 화면용)
 * @param {Array<{ id: number, listUrl?: string|null, url?: string|null }>} boardRows
 * @param {{ maxPages?: number, timeoutMs?: number, startDate?: string, endDate?: string }} options
 * @returns {Promise<Map<number, { listBasedCount: number|null, listBasedTotalRows: number, listBasedSkipped?: string, listBasedError?: string }>>}
 */
async function fetchListBasedCountsForBoards(boardRows, options = {}) {
  const maxPages = Math.min(Math.max(parseInt(String(options.maxPages || 10), 10) || 10, 1), 40);
  const timeoutMs = options.timeoutMs || 90000;
  const startDate = options.startDate ? String(options.startDate) : null;
  const endDate = options.endDate ? String(options.endDate) : null;

  const results = new Map();
  if (!Array.isArray(boardRows) || boardRows.length === 0) {
    return results;
  }

  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    for (const row of boardRows) {
      const id = Number(row.id);
      if (Number.isNaN(id)) continue;

      const listUrl = row.listUrl || row.url;
      if (!listUrl || !String(listUrl).includes('cafe.naver.com')) {
        const cacheKey = `${id}|__nocafe__|${startDate || ''}|${endDate || ''}|${maxPages}`;
        const cached = getListBasedCache(cacheKey);
        if (cached) {
          results.set(id, cached);
          continue;
        }
        const value = {
          listBasedCount: null,
          listBasedTotalRows: 0,
          listBasedSkipped: 'no_cafe_url'
        };
        results.set(id, value);
        setListBasedCache(cacheKey, value);
        continue;
      }

      try {
        const cacheKey = `${id}|${startDate || ''}|${endDate || ''}|${maxPages}`;
        const cached = getListBasedCache(cacheKey);
        if (cached) {
          results.set(id, cached);
          continue;
        }

        const fromDb = loadListBasedFromDbIfComplete(id, startDate, endDate, maxPages);
        if (fromDb) {
          results.set(id, fromDb);
          setListBasedCache(cacheKey, fromDb);
          continue;
        }

        const { dailyCounts, totalRows } = await fetchDailyCountFromListWithPage(page, listUrl, {
          maxPages,
          timeoutMs,
          startDate,
          endDate
        });
        const listBasedCount = sumDailyCountsInRange(dailyCounts, startDate, endDate);
        const value = {
          listBasedCount,
          listBasedTotalRows: totalRows,
          listBasedSkipped: null,
          listBasedFromDb: false
        };
        results.set(id, value);
        upsertBoardListDailySnapshots(id, dailyCounts, { scanTotalRows: totalRows, maxPagesUsed: maxPages });
        setListBasedCache(cacheKey, value);
      } catch (e) {
        logger.warn('[BoardListDailyCount] Board list fetch failed', {
          boardId: id,
          error: e.message
        });
        const cacheKey = `${id}|${startDate || ''}|${endDate || ''}|${maxPages}`;
        const value = {
          listBasedCount: null,
          listBasedTotalRows: 0,
          listBasedError: e.message || String(e)
        };
        results.set(id, value);
        setListBasedCache(cacheKey, value);
      }

      try {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
      } catch (_) {}
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return results;
}

module.exports = {
  fetchDailyCountFromList,
  fetchDailyCountFromListWithPage,
  fetchListBasedCountsForBoards,
  sumDailyCountsInRange,
  todayKST,
  parseDateText,
  upsertBoardListDailySnapshots,
  loadListBasedFromDbIfComplete,
  getBoardListDailySnapshots
};
