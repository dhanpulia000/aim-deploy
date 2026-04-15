/**
 * PUBG PC 주간 모니터링 보고서 생성 (VoC 엑셀 기반) - 최종 버전
 * - 입력: VoC 시트가 있는 엑셀 1개, 기간 자동(한국시간 달력 기준 지난주 월~일) 또는 startDate/endDate
 * - VoC: 헤더 4행, 데이터 5행~, 링크 컬럼 자동 감지 또는 N(14)열, 하이퍼링크 객체에서 URL 추출
 * - 산출물: PUBGPC_모니터링_주간보고서_YYYYMMDD_YYYYMMDD.xlsx, 건수 있는 모든 시트에 대표 링크 컬럼
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const ExcelJS = require('exceljs');
const logger = require('../utils/logger');
const { excelDateToISOString } = require('../utils/excel.util');
const { kstYmd, getLastCompletedKstWeekMonSun } = require('../utils/kstWeek.util');

const DATA_DIR = path.resolve(__dirname, '../data');
const SOURCES_DIR = path.join(DATA_DIR, 'weekly-pc-sources');
const OUTPUTS_DIR = path.join(DATA_DIR, 'weekly-pc-outputs');

// PC 고정 컬럼 (Excel 1-based: B=2, E=5, F=6, H=8, J=10, X=24, N=14 기본 링크)
const COL = { date: 2, category: 5, subCategory: 6, sentimentRaw: 8, content: 10, count: 24, linkDefault: 14 };
const LINK_HEADER_NAMES = ['링크', 'link', 'url', '대표링크', '대표 링크'];

function ensureDirectories() {
  [SOURCES_DIR, OUTPUTS_DIR].forEach(dir => {
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
      logger.info('[WeeklyVocReportFromExcelPc] Directory created', { path: dir });
    }
  });
}

function getCellValue(cell) {
  if (!cell) return null;
  if (cell.richText) return cell.richText.map(t => t.text || '').join('').trim();
  if (cell.formula && cell.result !== undefined) return cell.result;
  return cell.value;
}

/**
 * 셀에서 URL만 추출. Excel 하이퍼링크 객체({ text, hyperlink })인 경우 hyperlink 문자열만 반환.
 * 그대로 문자열로 변환하면 [object Object]가 되므로 전용 파싱 필요.
 */
function parseCellLink(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v == null) return null;
  // ExcelJS hyperlink 객체 ({ text, hyperlink })인 경우
  if (typeof v === 'object' && v !== null && typeof v.hyperlink === 'string') return v.hyperlink.trim() || null;
  if (typeof v === 'object' && v !== null && v.hyperlink != null) return String(v.hyperlink).trim() || null;
  // 수식 객체(예: HYPERLINK 함수)인 경우: formula 문자열에서 URL만 추출
  if (typeof v === 'object' && v !== null && typeof v.formula === 'string') {
    const f = v.formula.trim();
    // HYPERLINK("url","text") 또는 HYPERLINK("url")
    const m = f.match(/^HYPERLINK\(\s*"([^"]+)"(?:\s*,\s*"[^"]*")?\s*\)$/i);
    if (m && m[1]) return m[1].trim() || null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    // 셀에 수식 문자열이 그대로 들어온 경우 (=HYPERLINK("url","text"))
    const m = s.match(/^=HYPERLINK\(\s*"([^"]+)"(?:\s*,\s*"[^"]*")?\s*\)$/i);
    if (m && m[1]) return m[1].trim() || null;
    return s || null;
  }
  return null;
}

/** 헤더 행(1-based row 4)에서 링크 컬럼 인덱스(1-based) 반환. 없으면 N(14) */
function detectLinkColumn(vocSheet) {
  const headerRow = vocSheet.getRow(4);
  for (let c = 1; c <= (vocSheet.columnCount || 20); c++) {
    const raw = getCellValue(headerRow.getCell(c));
    const s = (raw != null ? String(raw) : '').trim();
    if (LINK_HEADER_NAMES.some(h => s === h || s.toLowerCase() === h.toLowerCase())) return c;
  }
  return COL.linkDefault;
}

function parseDateOnly(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    const s = excelDateToISOString(val);
    return s || null;
  }
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return m1[0];
  const m2 = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  const m3 = s.match(/^(\d{8})$/);
  if (m3) return `${m3[1].slice(0, 4)}-${m3[1].slice(4, 6)}-${m3[1].slice(6, 8)}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

function parseCount(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return Math.floor(val);
  const s = String(val).replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : Math.floor(n);
}

function normalizeSentiment(s) {
  const t = String(s || '').trim();
  if (t.includes('긍정')) return '긍정';
  if (t.includes('부정')) return '부정';
  return '중립';
}

function contentNorm(content) {
  if (!content || typeof content !== 'string') return '';
  const collapsed = content.replace(/\s+/g, ' ').trim();
  return collapsed.replace(/\d+$/g, '').trim();
}

async function loadVocSheet(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const vocSheet = workbook.worksheets.find(ws => ws.name.trim() === 'VoC');
  if (!vocSheet) throw new Error('VoC 시트가 없습니다.');

  const linkColIndex = detectLinkColumn(vocSheet);
  const rows = [];
  const HEADER_ROW = 4;
  const DATA_START = 5;

  for (let r = DATA_START; r <= vocSheet.rowCount; r++) {
    const row = vocSheet.getRow(r);
    const dateVal = getCellValue(row.getCell(COL.date));
    const dateStr = parseDateOnly(dateVal);
    if (!dateStr) continue;

    const count = parseCount(getCellValue(row.getCell(COL.count)));
    if (count <= 0) continue;

    const category = String(getCellValue(row.getCell(COL.category)) || '').trim();
    const subCategory = String(getCellValue(row.getCell(COL.subCategory)) || '').trim();
    const sentimentRaw = String(getCellValue(row.getCell(COL.sentimentRaw)) || '').trim();
    const content = String(getCellValue(row.getCell(COL.content)) || '').trim();
    const link = parseCellLink(row.getCell(linkColIndex));

    rows.push({
      date: dateStr,
      category,
      subCategory,
      sentimentRaw,
      sentiment_norm: normalizeSentiment(sentimentRaw),
      content,
      content_norm: contentNorm(content),
      count,
      link: link && typeof link === 'string' ? link : null
    });
  }

  if (rows.length === 0) throw new Error('유효한 데이터가 없습니다.');

  const dates = rows.map(r => r.date).filter(Boolean);
  const dateRange = {
    min: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '',
    max: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : ''
  };

  logger.info('[WeeklyVocReportFromExcelPc] loadVocSheet', { filePath, rowCount: rows.length, dateRange, linkColIndex });
  return { rows, dateRange };
}

function filterRowsByPeriod(rows, start, end) {
  return rows.filter(r => r.date >= start && r.date <= end);
}

/**
 * 그룹 생성 시 links 배열 초기화, 병합 시 link 문자열 push. set 전에 newGroup.links에 첫 행 link push.
 */
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) {
      const newGroup = {
        category: r.category,
        subCategory: r.subCategory,
        sentiment_norm: r.sentiment_norm,
        content_norm: r.content_norm,
        count: 0,
        rows: [],
        links: []
      };
      if (r.link && typeof r.link === 'string') newGroup.links.push(r.link);
      newGroup.count += r.count;
      newGroup.rows.push(r);
      map.set(key, newGroup);
    } else {
      const g = map.get(key);
      if (r.link && typeof r.link === 'string') g.links.push(r.link);
      g.count += r.count;
      g.rows.push(r);
    }
  }
  return Array.from(map.values()).map(g => {
    const longest = g.rows.reduce((a, b) => ((a?.content?.length || 0) >= (b?.content?.length || 0) ? a : b), g.rows[0]);
    return { ...g, content: longest?.content || '' };
  });
}

/** 건수 있는 시트의 대표 링크 셀: 표시 "1", 클릭 시 URL. 없으면 빈 문자열. 여러 개면 첫 URL 사용 */
function getRepresentativeLinkCell(links) {
  if (!links || !Array.isArray(links)) return '';
  const first = links.find(l => l != null && typeof l === 'string' && l.trim());
  if (!first) return '';
  return { text: '1', hyperlink: first.trim() };
}

function sortDetailGroups(groups) {
  return groups.sort((a, b) => {
    const cat = (a.category || '').localeCompare(b.category || '', 'ko');
    if (cat !== 0) return cat;
    const sub = (a.subCategory || '').localeCompare(b.subCategory || '', 'ko');
    if (sub !== 0) return sub;
    if (b.count !== a.count) return b.count - a.count;
    return (a.content || '').localeCompare(b.content || '', 'ko');
  });
}

function addPrefix(s) {
  const t = (s || '').trim();
  if (!t) return t;
  return t.startsWith('-') ? t : `- ${t}`;
}

async function generateReport(sourceFilePath, options = {}, sourceFileName = '') {
  ensureDirectories();
  const { periodMode = 'auto', startDate, endDate } = options;

  const { rows, dateRange } = await loadVocSheet(sourceFilePath);
  if (rows.length === 0) throw new Error('유효한 데이터가 없습니다.');

  let thisWeekStart, thisWeekEnd;
  if (periodMode === 'auto' || (!startDate && !endDate)) {
    const range = getLastCompletedKstWeekMonSun();
    thisWeekStart = range.start;
    thisWeekEnd = range.end;
  } else {
    if (!startDate || !endDate) throw new Error('기간 형식이 올바르지 않습니다. (YYYY-MM-DD)');
    if (startDate > endDate) throw new Error('시작일은 종료일보다 클 수 없습니다.');
    thisWeekStart = startDate;
    thisWeekEnd = endDate;
  }

  const filteredRows = filterRowsByPeriod(rows, thisWeekStart, thisWeekEnd);
  logger.info('[WeeklyVocReportFromExcelPc] Range', {
    kstToday: kstYmd(new Date()),
    thisWeekStart,
    thisWeekEnd,
    filteredCount: filteredRows.length
  });

  const jobId = `job_${Date.now()}`;
  const outDir = path.join(OUTPUTS_DIR, jobId);
  await fs.mkdir(outDir, { recursive: true });

  const dateStr = (d) => d.replace(/-/g, '');
  let outFileName = `PUBGPC_모니터링_주간보고서_${dateStr(thisWeekStart)}_${dateStr(thisWeekEnd)}.xlsx`;
  let outPath = path.join(outDir, outFileName);

  const workbook = new ExcelJS.Workbook();

  const LINK_COL = 6; // 순위/대분류/중분류/내용/건수/링크 또는 대분류/중분류/성향/내용/건수/링크

  // Sheet 1: 전반적인 동향(부정)
  const negRows = filteredRows.filter(r => r.sentiment_norm === '부정');
  const negGrouped = groupBy(negRows, r => `${r.category}\t${r.subCategory}\t${r.content_norm}`);
  const negSorted = negGrouped.sort((a, b) => b.count - a.count).slice(0, 6);
  const ws1 = workbook.addWorksheet('전반적인 동향(부정)');
  ws1.columns = [{ key: 'rank', width: 8 }, { key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws1.addRow(['순위', '대분류', '중분류', '내용', '건수', '링크']);
  negSorted.forEach((g, i) => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws1.addRow([i + 1, g.category, g.subCategory, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 2: 금주 최고의 동향 (긍정)
  const posRows = filteredRows.filter(r => r.sentiment_norm === '긍정');
  const posGrouped = groupBy(posRows, r => `${r.category}\t${r.subCategory}\t${r.content_norm}`);
  const posSorted = sortDetailGroups(posGrouped);
  const ws2 = workbook.addWorksheet('금주 최고의 동향');
  ws2.columns = [{ key: 'rank', width: 8 }, { key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws2.addRow(['순위', '대분류', '중분류', '내용', '건수', '링크']);
  posSorted.forEach((g, i) => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws2.addRow([i + 1, g.category, g.subCategory, addPrefix(g.content) || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 3: 금주 최악의 동향 (부정)
  const neg2Grouped = groupBy(negRows, r => `${r.category}\t${r.subCategory}\t${r.content_norm}`);
  const neg2Sorted = sortDetailGroups(neg2Grouped);
  const ws3 = workbook.addWorksheet('금주 최악의 동향');
  ws3.columns = [{ key: 'rank', width: 8 }, { key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws3.addRow(['순위', '대분류', '중분류', '내용', '건수', '링크']);
  neg2Sorted.forEach((g, i) => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws3.addRow([i + 1, g.category, g.subCategory, addPrefix(g.content) || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 4: 커뮤니티 동향
  const communityRows = filteredRows.filter(r => (r.category || '').trim() === '커뮤니티');
  const communityGrouped = groupBy(communityRows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const communitySorted = sortDetailGroups(communityGrouped);
  const ws4 = workbook.addWorksheet('커뮤니티 동향');
  ws4.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws4.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  communitySorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws4.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 5: 안티치트 동향
  const anticheatRows = filteredRows.filter(r => (r.category || '').replace(/\s/g, '').includes('불법프로그램'));
  const anticheatGrouped = groupBy(anticheatRows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const anticheatSorted = sortDetailGroups(anticheatGrouped);
  const ws5 = workbook.addWorksheet('안티치트 동향');
  ws5.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws5.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  anticheatSorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws5.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 6: 맵 서비스 리포트
  const mapSubNorm = (s) => (s || '').trim().replace(/\s/g, '');
  const mapRows = filteredRows.filter(r => {
    const cat = (r.category || '').trim();
    const sub = (r.subCategory || '').trim();
    const subN = mapSubNorm(r.subCategory);
    return cat === '컨텐츠' && (sub === '맵 서비스 리포트' || sub.startsWith('맵 서비스 리포트') || subN.includes('맵서비스리포트'));
  });
  const mapGrouped = groupBy(mapRows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const mapSorted = sortDetailGroups(mapGrouped);
  const ws6 = workbook.addWorksheet('맵 서비스 리포트');
  ws6.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws6.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  mapSorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws6.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 7: 패치노트 동향
  const patchRows = filteredRows.filter(r => (r.subCategory || '').trim().startsWith('#'));
  const patchGrouped = groupBy(patchRows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const patchSorted = sortDetailGroups(patchGrouped);
  const ws7 = workbook.addWorksheet('패치노트 동향');
  ws7.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws7.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  patchSorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws7.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 8: 2차 인증 관련 동향
  const auth2Rows = filteredRows.filter(r => (r.subCategory || '').replace(/\s/g, '').includes('2차인증'));
  const auth2Grouped = groupBy(auth2Rows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const auth2Sorted = sortDetailGroups(auth2Grouped);
  const ws8 = workbook.addWorksheet('2차 인증 관련 동향');
  ws8.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws8.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  auth2Sorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws8.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 9: 컨텐츠 동향 (맵/패치/2차인증 제외)
  const contentRows = filteredRows.filter(r => {
    const cat = (r.category || '').trim();
    const sub = (r.subCategory || '').trim();
    const subN = mapSubNorm(r.subCategory);
    if (cat !== '컨텐츠') return false;
    if (sub === '맵 서비스 리포트' || sub.startsWith('맵 서비스 리포트') || subN.includes('맵서비스리포트')) return false;
    if (sub.startsWith('#')) return false;
    if (subN.includes('2차인증')) return false;
    return true;
  });
  const contentGrouped = groupBy(contentRows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const contentSorted = sortDetailGroups(contentGrouped);
  const ws9 = workbook.addWorksheet('컨텐츠 동향');
  ws9.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws9.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  contentSorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws9.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 10: 인게임 동향
  const ingameRows = filteredRows.filter(r => {
    const cat = (r.category || '').trim();
    const catN = cat.replace(/\s/g, '');
    if (cat === '커뮤니티') return false;
    if (catN.includes('불법프로그램')) return false;
    return cat !== '컨텐츠';
  });
  const ingameGrouped = groupBy(ingameRows, r => `${r.category}\t${r.subCategory}\t${r.sentiment_norm}\t${r.content_norm}`);
  const ingameSorted = sortDetailGroups(ingameGrouped);
  const ws10 = workbook.addWorksheet('인게임 동향');
  ws10.columns = [{ key: 'category', width: 20 }, { key: 'subCategory', width: 20 }, { key: 'sentiment', width: 10 }, { key: 'content', width: 50 }, { key: 'count', width: 10 }, { key: 'link', width: 8 }];
  ws10.addRow(['대분류', '중분류', '성향', '내용', '건수', '링크']);
  ingameSorted.forEach(g => {
    const linkCell = getRepresentativeLinkCell(g.links);
    const row = ws10.addRow([g.category, g.subCategory, g.sentiment_norm, g.content || '', g.count, linkCell === '' ? '' : '1']);
    row.getCell(LINK_COL).value = linkCell;
  });

  // Sheet 11: 범위_정보
  const ws11 = workbook.addWorksheet('범위_정보');
  ws11.columns = [{ key: 'item', width: 20 }, { key: 'value', width: 40 }];
  ws11.addRow(['항목', '값']);
  ws11.addRow(['주간 시작일', thisWeekStart]);
  ws11.addRow(['주간 종료일', thisWeekEnd]);
  ws11.addRow(['소스 파일명', sourceFileName || path.basename(sourceFilePath)]);

  try {
    await workbook.xlsx.writeFile(outPath);
  } catch (e) {
    if (e.code === 'EPERM' || (e.message && e.message.includes('EPERM'))) {
      outFileName = `PUBGPC_모니터링_주간보고서_${dateStr(thisWeekStart)}_${dateStr(thisWeekEnd)}_${Date.now()}.xlsx`;
      outPath = path.join(outDir, outFileName);
      await workbook.xlsx.writeFile(outPath);
    } else throw e;
  }

  return {
    jobId,
    outputDir: `data/weekly-pc-outputs/${jobId}`,
    file: outFileName,
    periodStart: thisWeekStart,
    periodEnd: thisWeekEnd,
    message: '산출물이 생성되었습니다.'
  };
}

async function listSources() {
  ensureDirectories();
  const entries = await fs.readdir(SOURCES_DIR, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') continue;
    const fullPath = path.join(SOURCES_DIR, e.name);
    const stat = await fs.stat(fullPath);
    files.push({ sourceId: e.name, name: e.name, size: stat.size, uploadedAt: stat.mtime });
  }
  return files.sort((a, b) => (b.uploadedAt && a.uploadedAt ? b.uploadedAt - a.uploadedAt : 0));
}

async function deleteSource(sourceId) {
  const decoded = decodeURIComponent(String(sourceId));
  const safeName = path.basename(decoded).replace(/\.\./g, '').replace(/[/\\]/g, '') || 'unknown';
  const fullPath = path.join(SOURCES_DIR, safeName);
  try {
    await fs.access(fullPath);
  } catch {
    throw new Error('파일을 찾을 수 없습니다.');
  }
  await fs.unlink(fullPath);
  return true;
}

async function listOutputs() {
  ensureDirectories();
  const dirs = await fs.readdir(OUTPUTS_DIR, { withFileTypes: true });
  const jobs = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('job_')) continue;
    const jobDir = path.join(OUTPUTS_DIR, d.name);
    const files = await fs.readdir(jobDir, { withFileTypes: true });
    const xlsxFiles = files.filter(f => f.isFile() && (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')));
    for (const f of xlsxFiles) {
      const stat = await fs.stat(path.join(jobDir, f.name));
      const m = f.name.match(/(\d{8})_(\d{8})\.xlsx/);
      jobs.push({
        jobId: d.name,
        file: f.name,
        periodStart: m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}` : null,
        periodEnd: m ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}` : null,
        createdAt: stat.mtime
      });
    }
  }
  return jobs.sort((a, b) => (b.createdAt && a.createdAt ? b.createdAt - a.createdAt : 0));
}

function getOutputFilePath(jobId, fileName) {
  const safeJob = path.basename(jobId).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeFile = path.basename(fileName).replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
  return path.join(OUTPUTS_DIR, safeJob, safeFile);
}

async function deleteOutput(jobId) {
  const fullPath = path.join(OUTPUTS_DIR, path.basename(jobId));
  try {
    await fs.rm(fullPath, { recursive: true });
  } catch (e) {
    if (e.code === 'ENOENT') return true;
    throw e;
  }
  return true;
}

module.exports = {
  ensureDirectories,
  listSources,
  deleteSource,
  generateReport,
  listOutputs,
  getOutputFilePath,
  deleteOutput,
  SOURCES_DIR,
  OUTPUTS_DIR
};
