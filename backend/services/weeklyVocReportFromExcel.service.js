/**
 * PUBGM 주간보고서 생성 (VoC 엑셀 기반)
 * - 소스: PUBG MOBILE 일일 VoC 보고서 엑셀 (시트명 VoC)
 * - 산출물: 주간 모니터링 보고서 엑셀 (성향별·이슈별 동향)
 * @see docs/PUBGM_주간보고서_생성_개발명세서.md
 */

const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const axios = require('axios');
const logger = require('../utils/logger');
const { excelDateToISOString } = require('../utils/excel.util');
const {
  kstYmd,
  getLastCompletedKstWeekMonSun,
  getPreviousKstWeekMonSun
} = require('../utils/kstWeek.util');

const DATA_DIR = path.resolve(__dirname, '../data');
const SOURCES_DIR = path.join(DATA_DIR, 'weekly-sources');
const OUTPUTS_DIR = path.join(DATA_DIR, 'weekly-outputs');
const SOURCES_DIR_PC = path.join(DATA_DIR, 'weekly-sources-pc');
const OUTPUTS_DIR_PC = path.join(DATA_DIR, 'weekly-outputs-pc');

function getSourcesDir(platform = 'mobile') {
  return platform === 'pc' ? SOURCES_DIR_PC : SOURCES_DIR;
}
function getOutputsDir(platform = 'mobile') {
  return platform === 'pc' ? OUTPUTS_DIR_PC : OUTPUTS_DIR;
}
function getOutputFileNamePrefix(platform = 'mobile') {
  return platform === 'pc' ? 'PUBGPC_모니터링_주간보고서_' : 'PUBGMOBILE_모니터링_주간보고서_';
}

const STANDARD_ISSUE_ORDER = [
  '게임 플레이 문의',
  '유료화 아이템',
  '버그',
  '서버/접속',
  '이용 제한 조치',
  '불법 프로그램',
  '비매너행위',
  '커뮤니티 이용자 및 이스포츠 타게임 관련 내용'
];

const headerKeywords = {
  date: ['날짜', 'date', '일자'],
  category: ['대분류', 'category', '분류'],
  subCategory: ['중분류', 'sub_category', '소분류', '세부분류'],
  sentiment: ['성향', 'sentiment'],
  content: ['내용', 'content'],
  summary: ['요약', '요약문', 'i_col', 'summary'],
  count: ['건수', '실제 건수', 'count', '수량', '합계']
};

const defaultColumnMap = {
  date: 1,
  category: 3,
  subCategory: 4,
  sentiment: 6,
  content: 7,
  summary: 9,
  count: 23
};

/** VoC 시트 !ref가 수백만 행까지 잡히는 엑셀(빈 행 포함)에서 전체를 읽으면 수 분·OOM·504 타임아웃 발생 → 본문 행 수 상한 */
const MAX_VOC_BODY_ROWS = 100000;

function ensureDirectories(platform = 'mobile') {
  const dirs = [getSourcesDir(platform), getOutputsDir(platform)];
  dirs.forEach(dir => {
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
      logger.info('[WeeklyVocReportFromExcel] Directory created', { path: dir, platform });
    }
  });
}

/** 긴 동기 파싱(XLSX) 후에도 이벤트 루프가 돌도록 함 */
async function yieldToEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

function parseDate(cellValue) {
  if (cellValue == null || cellValue === '') return null;
  if (typeof cellValue === 'number') {
    const s = excelDateToISOString(cellValue);
    return s || null;
  }
  if (cellValue instanceof Date) {
    const y = cellValue.getFullYear();
    const m = String(cellValue.getMonth() + 1).padStart(2, '0');
    const d = String(cellValue.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(cellValue).trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
  const m3 = s.match(/^(\d{8})$/);
  if (m3) return `${m3[1].slice(0, 4)}-${m3[1].slice(4, 6)}-${m3[1].slice(6, 8)}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

/**
 * 헤더 셀인지 판별 (키워드와 동일하거나 짧은 레이블로 시작하는 경우만)
 * - "대분류", "중분류" 같은 헤더만 매칭하고, "대분류 관련 문의" 같은 본문은 제외
 */
function cellLooksLikeHeader(cellText, keywords) {
  const t = (cellText || '').trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (t === kw || t === kwLower) return true;
    if (lower.startsWith(kwLower) && t.length <= 12) return true;
    if (t.length <= 8 && lower.includes(kwLower)) return true;
  }
  return false;
}

/**
 * 시트 범위 — 전체 시트를 두 번 sheet_to_json 하면 대용량 VoC에서 메모리·지연이 커져 게이트웨이 504로 이어질 수 있음
 */
function getWorksheetRange(worksheet) {
  if (!worksheet || !worksheet['!ref']) return null;
  return XLSX.utils.decode_range(worksheet['!ref']);
}

/**
 * 컬럼 감지: 1~5행 중 "날짜"와 "대분류"가 모두 있는 행을 헤더로 보고, 그 행만 사용해 컬럼 인덱스 결정
 */
function detectVocColumns(worksheet) {
  const full = getWorksheetRange(worksheet);
  if (!full) {
    return { columnMap: { ...defaultColumnMap }, dataStartRow: 5 };
  }
  const headerRange = {
    s: { r: 0, c: full.s.c },
    e: { r: Math.min(4, full.e.r), c: full.e.c }
  };
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', range: headerRange });
  const map = { ...defaultColumnMap };
  const maxCol = 50;
  let headerRowIndex = -1;

  for (let rowIndex = 0; rowIndex < Math.min(5, data.length); rowIndex++) {
    const row = data[rowIndex] || [];
    let hasDate = false;
    let hasCategory = false;
    for (let colIndex = 0; colIndex < maxCol; colIndex++) {
      const cell = row[colIndex];
      const text = (cell != null ? String(cell).trim() : '');
      if (cellLooksLikeHeader(text, headerKeywords.date)) hasDate = true;
      if (cellLooksLikeHeader(text, headerKeywords.category)) hasCategory = true;
    }
    if (hasDate && hasCategory) {
      headerRowIndex = rowIndex;
      break;
    }
  }

  const rowToScan = headerRowIndex >= 0 ? [headerRowIndex] : [0, 1, 2, 3, 4];
  for (const rowIndex of rowToScan) {
    if (rowIndex >= data.length) continue;
    const row = data[rowIndex] || [];
    for (let colIndex = 0; colIndex < maxCol; colIndex++) {
      const cell = row[colIndex];
      const text = (cell != null ? String(cell).trim() : '');
      if (!text) continue;
      for (const [key, keywords] of Object.entries(headerKeywords)) {
        if (cellLooksLikeHeader(text, keywords)) {
          map[key] = colIndex;
          break;
        }
      }
    }
    if (headerRowIndex >= 0) break;
  }

  return { columnMap: map, dataStartRow: headerRowIndex >= 0 ? headerRowIndex + 1 : 5 };
}

/**
 * VoC 시트 로드 및 파싱
 * @returns {Promise<{ rows: Array, columnMap: Object, dateRange: { min: string, max: string }, skippedNoDate: number, skippedNoCount: number }>}
 */
async function loadVocSheet(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  await yieldToEventLoop();
  const sheetName = workbook.SheetNames.find(n => n.trim() === 'VoC') || workbook.SheetNames[0];
  if (!sheetName || (sheetName.trim() !== 'VoC' && workbook.SheetNames[0] !== sheetName)) {
    logger.warn('[VocParse] VoC sheet not found, using first sheet', { sheetName: workbook.SheetNames[0] });
  }
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error('VoC 시트가 없습니다.');
  }

  const { columnMap, dataStartRow } = detectVocColumns(worksheet);
  // PUBGM VoC 소스 형식: 대분류=D열(3), 중분류=E열(4) 고정 적용
  columnMap.category = 3;
  columnMap.subCategory = 4;
  const full = getWorksheetRange(worksheet);
  let data = [];
  if (full && dataStartRow <= full.e.r) {
    const cappedEndR = Math.min(full.e.r, dataStartRow + MAX_VOC_BODY_ROWS - 1);
    if (full.e.r > cappedEndR) {
      logger.warn('[VocParse] 시트 범위가 비정상적으로 큼 — 본문 읽기 행 수를 상한으로 자름 (엑셀에서 불필요한 하단 빈 행 삭제 권장)', {
        sheetRef: worksheet['!ref'],
        declaredLastRow0: full.e.r,
        dataStartRow,
        cappedEndRow0: cappedEndR,
        maxBodyRows: MAX_VOC_BODY_ROWS
      });
    }
    const bodyRange = {
      s: { r: dataStartRow, c: full.s.c },
      e: { r: cappedEndR, c: full.e.c }
    };
    data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', range: bodyRange });
  }
  const rows = [];
  let skippedNoDate = 0;
  let skippedNoCount = 0;
  const dateSamples = [];

  let rowIter = 0;
  for (let i = 0; i < data.length; i++) {
    const row = data[i] || [];
    const dateVal = row[columnMap.date];
    const dateStr = parseDate(dateVal);
    if (!dateStr) {
      skippedNoDate++;
      continue;
    }
    let count = 0;
    const countVal = row[columnMap.count];
    if (countVal != null && countVal !== '') {
      count = Number(countVal);
      if (Number.isNaN(count)) count = 1;
    } else {
      count = 1;
    }
    if (count <= 0) {
      skippedNoCount++;
      continue;
    }
    const rawCat = row[columnMap.category];
    const rawSub = row[columnMap.subCategory];
    const category = (rawCat != null && rawCat !== '') ? String(rawCat).trim() : '';
    const subCategory = (rawSub != null && rawSub !== '') ? String(rawSub).trim() : '';
    if (dateSamples.length < 5) dateSamples.push(dateStr);
    rows.push({
      date: dateStr,
      category,
      subCategory,
      sentiment: String(row[columnMap.sentiment] ?? '').trim(),
      content: String(row[columnMap.content] ?? '').trim(),
      summary: String(row[columnMap.summary] ?? '').trim(),
      count
    });
    rowIter++;
    if (rowIter % 400 === 0) {
      await yieldToEventLoop();
    }
  }

  const dates = rows.map(r => r.date).filter(Boolean);
  const dateRange = {
    min: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '',
    max: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : ''
  };

  const categorySamples = rows.slice(0, 5).map(r => ({ category: r.category, subCategory: r.subCategory }));

  logger.info('[VocParse] loadVocSheet', {
    filePath,
    columnMap,
    dataStartRow,
    rowCount: rows.length,
    dateRange,
    skippedNoDate,
    skippedNoCount,
    dateSamples,
    categorySamples
  });

  return { rows, columnMap, dateRange, skippedNoDate, skippedNoCount };
}

/**
 * 날짜 문자열에 일수 더하기/빼기 (로컬 날짜 기준, YYYY-MM-DD 반환)
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 지난 주 구간
 * - 주간(자동): 이번 주 시작일 직전 7일 → 01-26~02-01 (이번 주 02-02~02-08일 때)
 * - 기간 지정: (시작일 - 1일) 기준 직전 N일 (N = 이번 주 일수)
 * @param {string} thisWeekStart - 이번 주 시작일
 * @param {string} thisWeekEnd - 이번 주 종료일
 * @param {number} [daysInPeriod=7] - 이번 주 일수 (기간 지정 시 전달)
 */
function getPreviousWeekRange(thisWeekStart, thisWeekEnd, daysInPeriod = 7) {
  const prevEnd = addDays(thisWeekStart, -1);
  const prevStart = addDays(thisWeekStart, -daysInPeriod);
  return { start: prevStart, end: prevEnd };
}

function normalizeSentiment(s) {
  const t = (s || '').trim().toLowerCase();
  if (t.includes('긍정') || t === 'pos' || t === 'positive') return '긍정';
  if (t.includes('부정') || t === 'neg' || t === 'negative') return '부정';
  return '중립';
}

function filterRowsByPeriod(rows, start, end) {
  return rows.filter(r => r.date >= start && r.date <= end);
}

function aggregateBySentiment(rows) {
  const map = { 긍정: 0, 부정: 0, 중립: 0 };
  for (const r of rows) {
    const s = normalizeSentiment(r.sentiment);
    map[s] = (map[s] || 0) + (r.count || 1);
  }
  return map;
}

function aggregateByCategory(rows) {
  const map = {};
  for (const r of rows) {
    const cat = r.category || '(미분류)';
    map[cat] = (map[cat] || 0) + (r.count || 1);
  }
  return map;
}

function aggregateByCategorySub(rows) {
  const map = {};
  for (const r of rows) {
    const key = `${r.category || '(미분류)'}\t${r.subCategory || ''}`;
    if (!map[key]) map[key] = { category: r.category || '(미분류)', subCategory: r.subCategory || '', count: 0, rows: [] };
    map[key].count += (r.count || 1);
    map[key].rows.push(r);
  }
  return Object.values(map);
}

/** 상위 N건 VoC를 "1. 내용 (n건)" 형식 문자열로 반환 (건수 기준 정렬) */
function formatVocAsNumberedList(rows, topN = 10) {
  const sorted = [...(rows || [])]
    .filter(r => (r.content || r.summary || '').trim())
    .sort((a, b) => (b.count || 1) - (a.count || 1))
    .slice(0, topN);
  if (sorted.length === 0) return '(해당 없음)';
  return sorted
    .map((r, i) => {
      const content = (r.content || r.summary || '').trim().slice(0, 200);
      const cnt = r.count || 1;
      return `${i + 1}. ${content} (${cnt}건)`;
    })
    .join('\n');
}

/**
 * 단일 성향 VoC로 JSON 배열 요약 생성 (프롬프트: 이슈별 건수 반영, JSON 배열만 출력)
 * @returns {Promise<Array<{ summary: string, total_count: number }>>} 항목별 요약·건수 배열 (시트에서 항목별 한 행)
 */
async function summarizeOneSentimentWithOpenAI(apiKey, baseUrl, model, sentimentLabel, numberedVocText) {
  if (!numberedVocText || numberedVocText === '(해당 없음)') {
    return [];
  }
  const lineCount = (numberedVocText.match(/\n/g) || []).length + 1;
  const formatExamples = sentimentLabel === '부정'
    ? '예시 형식: "Hola Buddy (2026.02.06 출시) 뽑기 결과에 대한 부정적인 후기", "일시적 접속 불가 현상에 대한 문의", "팀킬 신고 후 패널티 해소 되는 현상 해결 요청".'
    : '예시 형식: "불법 프로그램 이용자 신고 후 피드백 메시지 수신하여 만족스러움", "킹오브 파이터즈(26-01-30 출시) 뽑기에 대한 긍정적인 후기", "에스파 상자(26/01/15) 뽑기 결과에 대한 긍정적인 후기".';
  const prompt = [
    `${sentimentLabel} VoC 주간 데이터(상위 ${lineCount}건). 이슈별 건수 합계를 반영한 요약을 생성하세요.`,
    `요약문은 반드시 한 줄로, 넘버링 없이 내용만. ${formatExamples} summary 필드에 (N건)을 붙이지 말고, 건수는 total_count에만 숫자로. 중요도(상·중·하) 포함 금지.`,
    '응답은 JSON 배열만 출력. 각 원소: {"summary": "한 줄 요약 내용", "total_count": 숫자}.',
    '',
    numberedVocText
  ].join('\n');

  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: '응답은 반드시 JSON 배열만 출력하세요. 다른 설명이나 마크다운 없이 배열만 출력합니다. 각 summary는 한 줄 요약(넘버링·(N건) 없음).' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 800
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 25000
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return [];

    let jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr) || arr.length === 0) return [];

    return arr
      .filter((o) => typeof o === 'object' && o && typeof o.summary === 'string')
      .map((o) => ({
        summary: String(o.summary).trim(),
        total_count: typeof o.total_count === 'number' ? o.total_count : (typeof o.total_count === 'string' ? parseInt(o.total_count, 10) : 0) || 0
      }))
      .filter((o) => o.summary);
  } catch (err) {
    logger.warn('[WeeklyVocReportFromExcel] LLM 단일 성향 요약 실패', { sentiment: sentimentLabel, error: err.message });
    return [];
  }
}

/**
 * 이번 주 VoC로 긍정/부정 동향 요약 생성 (연동된 OpenAI API 키 사용)
 * - 입력: 성향별 건수 상위 10건 번호 목록 형식
 * - 출력: 항목별 { summary, total_count } 배열 (시트에서 항목별 한 행)
 * @param {{ thisWeekStart: string, thisWeekEnd: string, thisWeekRows: Array<{ sentiment?: string, category?: string, content?: string, summary?: string, count?: number }> }} opts
 * @returns {Promise<{ negItems: Array<{ summary: string, total_count: number }>, posItems: Array<{ summary: string, total_count: number }> } | null>}
 */
async function summarizeVocWithOpenAI(opts) {
  const { thisWeekStart, thisWeekEnd, thisWeekRows } = opts;
  const AI_API_KEY = process.env.OPENAI_API_KEY;
  const AI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const AI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!AI_API_KEY) return null;

  const negRows = (thisWeekRows || []).filter(r => normalizeSentiment(r.sentiment) === '부정');
  const posRows = (thisWeekRows || []).filter(r => normalizeSentiment(r.sentiment) === '긍정');

  const negNumbered = formatVocAsNumberedList(negRows, 10);
  const posNumbered = formatVocAsNumberedList(posRows, 10);

  const [negItems, posItems] = await Promise.all([
    summarizeOneSentimentWithOpenAI(AI_API_KEY, AI_BASE_URL, AI_MODEL, '부정', negNumbered),
    summarizeOneSentimentWithOpenAI(AI_API_KEY, AI_BASE_URL, AI_MODEL, '긍정', posNumbered)
  ]);

  const hasAny = (Array.isArray(negItems) && negItems.length > 0) || (Array.isArray(posItems) && posItems.length > 0);
  if (!hasAny) return null;

  logger.info('[WeeklyVocReportFromExcel] LLM 동향 요약 생성 완료');
  return {
    negItems: Array.isArray(negItems) ? negItems : [],
    posItems: Array.isArray(posItems) ? posItems : []
  };
}

/**
 * 산출물 생성
 * @param {string} sourceFilePath - 소스 엑셀 경로
 * @param {Object} options - { useAutoPeriod?: number, startDate?: string, endDate?: string, platform?: 'pc'|'mobile' }
 * @param {string} sourceFileName - 소스 파일명 (메타에 사용)
 */
async function generateReport(sourceFilePath, options = {}, sourceFileName = '') {
  const platform = options.platform === 'pc' ? 'pc' : 'mobile';
  ensureDirectories(platform);
  const { useAutoPeriod, startDate, endDate } = options;

  const perfStart = Date.now();
  const { rows, dateRange } = await loadVocSheet(sourceFilePath);
  const perfAfterLoad = Date.now();
  if (rows.length === 0) {
    throw new Error('VoC 시트에 유효한 데이터가 없습니다.');
  }

  let thisWeekStart, thisWeekEnd, prevWeekStart, prevWeekEnd;
  if (useAutoPeriod === 1 || (!startDate && !endDate)) {
    // 주간(자동): 한국시간 달력 기준 직전 완료 주(월~일). VoC 파일 날짜와 무관.
    const range = getLastCompletedKstWeekMonSun();
    thisWeekStart = range.start;
    thisWeekEnd = range.end;
    const prev = getPreviousKstWeekMonSun(thisWeekStart);
    prevWeekStart = prev.start;
    prevWeekEnd = prev.end;
  } else {
    if (!startDate || !endDate) throw new Error('기간 형식이 올바르지 않습니다. (YYYY-MM-DD)');
    if (startDate > endDate) throw new Error('시작일은 종료일보다 클 수 없습니다.');
    thisWeekStart = startDate;
    thisWeekEnd = endDate;
    const startMs = new Date(thisWeekStart + 'T12:00:00').getTime();
    const endMs = new Date(thisWeekEnd + 'T12:00:00').getTime();
    const daysInPeriod = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
    const prev = getPreviousWeekRange(startDate, endDate, Math.max(1, daysInPeriod));
    prevWeekStart = prev.start;
    prevWeekEnd = prev.end;
  }

  const thisWeekRows = filterRowsByPeriod(rows, thisWeekStart, thisWeekEnd);
  const prevWeekRows = filterRowsByPeriod(rows, prevWeekStart, prevWeekEnd);

  logger.info('[WeeklyVocReportFromExcel] Range diagnostics', {
    useAutoPeriod: useAutoPeriod === 1,
    kstToday: kstYmd(new Date()),
    thisWeekStart,
    thisWeekEnd,
    prevWeekStart,
    prevWeekEnd,
    thisWeekCount: thisWeekRows.length,
    prevWeekCount: prevWeekRows.length,
    vocDateRange: dateRange
  });

  const jobId = `job_${Date.now()}`;
  const outputsDir = getOutputsDir(platform);
  const outDir = path.join(outputsDir, jobId);
  await fs.mkdir(outDir, { recursive: true });

  const dateStr = (d) => d.replace(/-/g, '');
  const prefix = getOutputFileNamePrefix(platform);
  const outFileName = `${prefix}${dateStr(thisWeekStart)}_${dateStr(thisWeekEnd)}.xlsx`;
  const outPath = path.join(outDir, outFileName);

  const workbook = new ExcelJS.Workbook();

  // Sheet 1: 성향별 주간 동향 수 — 성향=열, 이번주/지난주/증감=행
  const sentThis = aggregateBySentiment(thisWeekRows);
  const sentPrev = aggregateBySentiment(prevWeekRows);
  const sentimentCols = ['긍정', '부정', '중립'];
  const ws1 = workbook.addWorksheet('성향별 주간 동향 수');
  ws1.addRow(['', ...sentimentCols]); // 헤더: 빈칸 + 긍정/부정/중립
  const row1 = ['이번주', ...sentimentCols.map(s => sentThis[s] || 0)];
  const row2 = ['지난주', ...sentimentCols.map(s => sentPrev[s] || 0)];
  const row3 = ['증감', ...sentimentCols.map(s => {
    const diff = (sentThis[s] || 0) - (sentPrev[s] || 0);
    return diff >= 0 ? `+${diff}` : String(diff);
  })];
  ws1.addRow(row1);
  ws1.addRow(row2);
  ws1.addRow(row3);

  // Sheet 2: 이슈 별 동향 수 — 이슈=열, 이번주/지난주/증감=행
  const catThis = aggregateByCategory(thisWeekRows);
  const catPrev = aggregateByCategory(prevWeekRows);
  const allCats = new Set([...Object.keys(catThis), ...Object.keys(catPrev)]);
  const sortedCats = [...allCats].sort((a, b) => {
    const ai = STANDARD_ISSUE_ORDER.indexOf(a);
    const bi = STANDARD_ISSUE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return (catThis[b] || 0) - (catThis[a] || 0);
  });
  const ws2 = workbook.addWorksheet('이슈 별 동향 수');
  ws2.addRow(['', ...sortedCats]); // 헤더: 빈칸 + 이슈1, 이슈2, ...
  ws2.addRow(['이번주', ...sortedCats.map(cat => catThis[cat] || 0)]);
  ws2.addRow(['지난주', ...sortedCats.map(cat => catPrev[cat] || 0)]);
  ws2.addRow(['증감', ...sortedCats.map(cat => (catThis[cat] || 0) - (catPrev[cat] || 0))]);
  const perfAfterSheet12 = Date.now();

  // Sheet 3: 주간 동향 상세 요약 — 이번 주 VoC 전체 리스트 (행 단위, 요약문 앞에 >, 문장 끝에 건수 표기)
  const ws3 = workbook.addWorksheet('주간 동향 상세 요약');
  ws3.addRow(['성향', '대분류', '중분류', '건수', '대표 내용', '요약문']);
  const sortedFullRows = [...thisWeekRows].sort((a, b) => {
    const dateCmp = (a.date || '').localeCompare(b.date || '');
    if (dateCmp !== 0) return dateCmp;
    const catCmp = (a.category || '').localeCompare(b.category || '');
    if (catCmp !== 0) return catCmp;
    return (a.subCategory || '').localeCompare(b.subCategory || '');
  });
  for (let ri = 0; ri < sortedFullRows.length; ri++) {
    const r = sortedFullRows[ri];
    const contentText = (r.content || '').slice(0, 200).trim();
    const summaryText = (r.summary || '').slice(0, 200).trim();
    const n = r.count || 1;
    const countSuffix = ` (${n}건)`;
    const representativeContent = contentText ? contentText + countSuffix : String(n) + '건';
    const summaryWithPrefix = summaryText ? '> ' + summaryText + countSuffix : '> ' + countSuffix.trim();
    ws3.addRow([
      normalizeSentiment(r.sentiment),
      r.category || '',
      r.subCategory || '',
      n,
      representativeContent,
      summaryWithPrefix
    ]);
    if (ri > 0 && ri % 250 === 0) {
      await yieldToEventLoop();
    }
  }
  const perfAfterSheet3 = Date.now();

  // Sheet 4: 동향 요약 (LLM) - OPENAI_API_KEY 설정 시 연동 API로 요약 생성, 실패 시 시트 생략
  let llmSummary = null;
  const perfLlmStart = Date.now();
  if (process.env.OPENAI_API_KEY) {
    try {
      await yieldToEventLoop();
      llmSummary = await summarizeVocWithOpenAI({
        thisWeekStart,
        thisWeekEnd,
        thisWeekRows
      });
      await yieldToEventLoop();
    } catch (_) {
      llmSummary = null;
    }
  }
  const perfAfterLlm = Date.now();
  if (llmSummary) {
    const ws4 = workbook.addWorksheet('동향 요약 (LLM)');
    ws4.addRow(['구분', '요약', '건수']);
    (llmSummary.negItems || []).forEach((item, i) => {
      const line = `${i + 1}. ${item.summary} (${item.total_count}건)`;
      ws4.addRow(['부정', line, item.total_count]);
    });
    (llmSummary.posItems || []).forEach((item, i) => {
      const line = `${i + 1}. ${item.summary} (${item.total_count}건)`;
      ws4.addRow(['긍정', line, item.total_count]);
    });
  }

  // Sheet 5: 주요 이슈 증감
  const ws5 = workbook.addWorksheet('주요 이슈 증감');
  ws5.addRow(['대분류', '중분류', '이번주_건수', '직전주_건수', '증감']);
  const catSubThis = aggregateByCategorySub(thisWeekRows);
  const catSubPrev = aggregateByCategorySub(prevWeekRows);
  const prevMap = {};
  catSubPrev.forEach(g => {
    const key = `${g.category}\t${g.subCategory}`;
    prevMap[key] = g.count;
  });
  catSubThis.sort((a, b) => b.count - a.count);
  catSubThis.forEach(g => {
    const key = `${g.category}\t${g.subCategory}`;
    const prevCount = prevMap[key] || 0;
    ws5.addRow([g.category, g.subCategory, g.count, prevCount, g.count - prevCount]);
  });

  // Sheet 6: DB_게시물_량(참고) - placeholder
  const ws6 = workbook.addWorksheet('DB_게시물_량(참고)');
  ws6.addRow(['날짜', 'post_count', '주간_합계']);
  ws6.addRow(['(참고용 - DB 연동 시 채움)', '', '']);

  // Sheet 7: 주간_범위_정보
  const ws7 = workbook.addWorksheet('주간_범위_정보');
  ws7.addRow(['항목', '값']);
  ws7.addRow(['주간 시작일', thisWeekStart]);
  ws7.addRow(['주간 종료일', thisWeekEnd]);
  ws7.addRow(['소스 파일명', sourceFileName || path.basename(sourceFilePath)]);

  const perfBeforeWrite = Date.now();
  await yieldToEventLoop();
  const tmpOutPath = `${outPath}.writing`;
  try {
    await workbook.xlsx.writeFile(tmpOutPath);
    await fs.rename(tmpOutPath, outPath);
  } catch (writeErr) {
    try {
      await fs.unlink(tmpOutPath);
    } catch (_) {
      /* ignore */
    }
    throw writeErr;
  }
  const perfEnd = Date.now();

  logger.info('[WeeklyVocReportFromExcel] generateReport timing (ms)', {
    loadVocMs: perfAfterLoad - perfStart,
    buildSheet1And2Ms: perfAfterSheet12 - perfAfterLoad,
    buildSheet3DetailMs: perfAfterSheet3 - perfAfterSheet12,
    llmMs: process.env.OPENAI_API_KEY ? perfAfterLlm - perfLlmStart : 0,
    buildSheet5to7Ms: perfBeforeWrite - perfAfterLlm,
    writeFileMs: perfEnd - perfBeforeWrite,
    totalMs: perfEnd - perfStart,
    sourceRowCount: rows.length,
    thisWeekRowCount: thisWeekRows.length,
    detailSheetRowCount: sortedFullRows.length,
    llmSkipped: !process.env.OPENAI_API_KEY
  });

  const outputsBase = platform === 'pc' ? 'data/weekly-outputs-pc' : 'data/weekly-outputs';
  return {
    jobId,
    outputDir: `${outputsBase}/${jobId}`,
    file: outFileName,
    periodStart: thisWeekStart,
    periodEnd: thisWeekEnd,
    message: '산출물이 생성되었습니다.'
  };
}

async function listSources(platform = 'mobile') {
  ensureDirectories(platform);
  const sourcesDir = getSourcesDir(platform);
  const entries = await fs.readdir(sourcesDir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') continue;
    const fullPath = path.join(sourcesDir, e.name);
    const stat = await fs.stat(fullPath);
    files.push({
      sourceId: e.name,
      name: e.name,
      size: stat.size,
      uploadedAt: stat.mtime
    });
  }
  return files.sort((a, b) => (b.uploadedAt && a.uploadedAt ? b.uploadedAt - a.uploadedAt : 0));
}

async function deleteSource(sourceId, platform = 'mobile') {
  const decoded = decodeURIComponent(String(sourceId));
  const safeName = path.basename(decoded).replace(/\.\./g, '').replace(/[/\\]/g, '') || 'unknown';
  const fullPath = path.join(getSourcesDir(platform), safeName);
  try {
    await fs.access(fullPath);
  } catch {
    throw new Error('파일을 찾을 수 없습니다.');
  }
  await fs.unlink(fullPath);
  return true;
}

async function listOutputs(platform = 'mobile') {
  ensureDirectories(platform);
  const outputsDir = getOutputsDir(platform);
  const dirs = await fs.readdir(outputsDir, { withFileTypes: true });
  const jobs = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith('job_')) continue;
    const jobDir = path.join(outputsDir, d.name);
    const files = await fs.readdir(jobDir, { withFileTypes: true });
    const xlsxFiles = files.filter(
      f =>
        f.isFile() &&
        (f.name.endsWith('.xlsx') || f.name.endsWith('.xls')) &&
        !f.name.endsWith('.writing')
    );
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

function getOutputFilePath(jobId, fileName, platform = 'mobile') {
  const safeJob = path.basename(jobId).replace(/[^a-zA-Z0-9_-]/g, '');
  const safeFile = path.basename(fileName).replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
  return path.join(getOutputsDir(platform), safeJob, safeFile);
}

async function deleteOutput(jobId, platform = 'mobile') {
  const fullPath = path.join(getOutputsDir(platform), path.basename(jobId));
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
  getSourcesDir,
  getOutputsDir,
  SOURCES_DIR,
  OUTPUTS_DIR,
  SOURCES_DIR_PC,
  OUTPUTS_DIR_PC
};
