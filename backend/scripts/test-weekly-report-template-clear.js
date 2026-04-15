#!/usr/bin/env node
/**
 * 주간보고서 생성 결과물에서 템플릿 데이터가 완전히 삭제되었는지 전체 검증
 *
 * 1. 최소 일일보고서 엑셀 생성 (VoC + Issue 시트)
 * 2. generateWeeklyReportFromExcel 호출 → PC/Mobile 각각 생성
 * 3. 생성된 엑셀을 열어 데이터 영역 스캔:
 *    - 각 시트별 "데이터 영역" 끝(lastDataRow) 이후 행은 전부 빈 칸이어야 함
 *    - 데이터 영역 내에 템플릿용 플레이스홀더(샘플, 예시 등) 문자열이 있으면 실패
 *
 * 사용법:
 *   cd backend && node scripts/test-weekly-report-template-clear.js
 * 서버 재시작 불필요: 서비스를 직접 require 하므로 코드 변경 후 스크립트만 다시 실행하면 됨.
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

// backend 기준 상대 경로
const backendRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendRoot, '.env') });

const weeklyReportService = require(path.join(backendRoot, 'services', 'weeklyReport.service'));

const START_DATE = '2026-01-20';
const END_DATE = '2026-01-26';
const PROJECT_IDS = { PC: 1, MOBILE: 2 };

/** 셀 값을 문자열로 정규화 (빈 칸 판단용) */
function cellToString(cell) {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') {
    if (v.text != null) return String(v.text).trim();
    if (v.richText && Array.isArray(v.richText)) {
      return v.richText.map(t => (t && t.text) || '').join('').trim();
    }
  }
  return String(v).trim();
}

/** 데이터 영역 정의: { sheetName, startRow, endRow, cols, skipCols?, description } */
function getDataRegions(platform) {
  const regions = [];
  if (platform === 'mobile') {
    regions.push(
      { sheetName: 'VoC', startRow: 5, endRow: 500, cols: [1, 20], description: 'VoC 데이터(5~500행, A~T)' },
      { sheetName: '공유 이슈 시간 순', startRow: 3, endRow: 500, cols: [1, 12], description: '공유 이슈(3~500행)' },
      { sheetName: '주요 이슈 건수 증감', startRow: 8, endRow: 120, cols: [1, 9], description: '건수 증감(8~120행)' }
    );
    // 주차 시트: 이름에 '주차' 포함
    regions.push({
      sheetName: null,
      nameContains: '주차',
      startRow: 15,
      endRow: 600,
      cols: [1, 16],
      description: '메인 주차 시트 동향(15~600행)'
    });
  } else {
    regions.push({
      sheetName: null,
      nameContains: '주차',
      startRow: 26,
      endRow: 600,
      cols: [1, 16],
      description: '메인 주차 시트 동향(26~600행)'
    });
    regions.push({
      sheetName: '커뮤니티 일반',
      startRow: 6,
      endRow: 1000,
      cols: [2, 23],
      skipCols: [9],
      description: '커뮤니티 일반(6~1000행, I열 제외)'
    });
  }
  return regions;
}

/** 시트에서 데이터 영역 내 마지막으로 값이 있는 행 번호 반환 (없으면 startRow-1) */
function findLastDataRow(sheet, startRow, endRow, colStart, colEnd, skipCols = []) {
  let last = startRow - 1;
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    for (let c = colStart; c <= colEnd; c++) {
      if (skipCols.includes(c)) continue;
      const val = cellToString(row.getCell(c));
      if (val !== '') {
        last = r;
        break;
      }
    }
  }
  return last;
}

/** (lastDataRow+1) ~ endRow 구간에 비어있지 않은 셀이 있으면 [{row,col,value}, ...] 반환 */
function findNonEmptyAfterLast(sheet, lastDataRow, endRow, colStart, colEnd, skipCols = []) {
  const found = [];
  for (let r = lastDataRow + 1; r <= endRow; r++) {
    const row = sheet.getRow(r);
    for (let c = colStart; c <= colEnd; c++) {
      if (skipCols.includes(c)) continue;
      const val = cellToString(row.getCell(c));
      if (val !== '') {
        found.push({ row: r, col: c, value: val.slice(0, 50) });
      }
    }
  }
  return found;
}

/** 데이터 영역 전체에서 플레이스홀더 문자열 포함 셀 찾기 */
const PLACEHOLDER_PATTERNS = [
  /샘플/i,
  /예시/i,
  /예제/i,
  /sample\s*data/i,
  /test\s*data/i,
  /dummy/i,
  /placeholder/i
];

function findPlaceholderInRegion(sheet, startRow, endRow, colStart, colEnd, skipCols = []) {
  const found = [];
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    for (let c = colStart; c <= colEnd; c++) {
      if (skipCols.includes(c)) continue;
      const val = cellToString(row.getCell(c));
      if (val === '') continue;
      for (const re of PLACEHOLDER_PATTERNS) {
        if (re.test(val)) {
          found.push({ row: r, col: c, value: val.slice(0, 60) });
          break;
        }
      }
    }
  }
  return found;
}

/** 최소 일일보고서 엑셀 생성 (VoC + Issue 시트, 기간 내 데이터 2건) */
function createMinimalDailyExcel(filePath, startDate, endDate) {
  const wb = new ExcelJS.Workbook();
  const vocSheet = wb.addWorksheet('VoC', { properties: {} });
  vocSheet.getRow(1).values = [
    '',
    '날짜',
    '플랫폼',
    '내용',
    '성향',
    '대분류',
    '중분류',
    '출처',
    '종류',
    '중요도',
    '판단/확인사항',
    '근무',
    '비고',
    '링크'
  ];
  vocSheet.getRow(2).values = [
    '',
    startDate,
    'Steam',
    '테스트 VoC 내용',
    '부정',
    '버그',
    '버그',
    '디스코드',
    '일반',
    '',
    '',
    '',
    '',
    ''
  ];
  vocSheet.getRow(3).values = [
    '',
    endDate,
    'Steam',
    '테스트 VoC 내용2',
    '긍정',
    '게임 플레이 관련 문의',
    '클래식',
    '디스코드',
    '일반',
    '',
    '',
    '',
    '',
    ''
  ];

  const issueSheet = wb.addWorksheet('Issue', { properties: {} });
  issueSheet.getRow(1).values = ['날짜', '요약', '세부 내용', '분류', '공유시간', '공유방식', '성향'];
  issueSheet.getRow(2).values = [startDate, '테스트 이슈 요약', '세부 내용', '버그', new Date(), '슬랙', '부정'];

  return wb.xlsx.writeFile(filePath);
}

/** 생성된 버퍼로 워크북 로드 후 템플릿 잔존 검사 */
async function assertNoTemplateResidue(buffer, platform) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const regions = getDataRegions(platform);
  const errors = [];
  const sheetNames = wb.worksheets.map(s => s.name);

  for (const reg of regions) {
    let sheet = null;
    if (reg.sheetName) {
      sheet = wb.getWorksheet(reg.sheetName);
    } else if (reg.nameContains) {
      sheet = wb.worksheets.find(s => s.name.includes(reg.nameContains));
    }
    if (!sheet) {
      errors.push({ region: reg.description, error: `시트 없음: ${reg.sheetName || reg.nameContains}` });
      continue;
    }

    const [colStart, colEnd] = reg.cols;
    const skipCols = reg.skipCols || [];

    const lastDataRow = findLastDataRow(sheet, reg.startRow, reg.endRow, colStart, colEnd, skipCols);
    const nonEmptyAfter = findNonEmptyAfterLast(
      sheet,
      lastDataRow,
      reg.endRow,
      colStart,
      colEnd,
      skipCols
    );
    if (nonEmptyAfter.length > 0) {
      errors.push({
        region: reg.description,
        sheet: sheet.name,
        error: '데이터 마지막 행 이후에 템플릿/빈칸 아닌 값 존재',
        samples: nonEmptyAfter.slice(0, 5)
      });
    }

    const placeholders = findPlaceholderInRegion(
      sheet,
      reg.startRow,
      reg.endRow,
      colStart,
      colEnd,
      skipCols
    );
    if (placeholders.length > 0) {
      errors.push({
        region: reg.description,
        sheet: sheet.name,
        error: '데이터 영역 내 플레이스홀더(샘플/예시 등) 문자열 발견',
        samples: placeholders.slice(0, 5)
      });
    }
  }

  return { errors, sheetNames };
}

async function run() {
  console.log('=== 주간보고서 템플릿 데이터 삭제 검증 테스트 ===\n');

  const tempDir = path.join(backendRoot, 'tmp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const dailyPath = path.join(tempDir, 'test-daily-for-template-clear.xlsx');

  let totalErrors = [];
  let testsRun = 0;

  try {
    await createMinimalDailyExcel(dailyPath, START_DATE, END_DATE);
    console.log('1. 최소 일일보고서 엑셀 생성:', dailyPath);
  } catch (e) {
    console.error('일일보고서 생성 실패:', e.message);
    process.exit(1);
  }

  for (const [platform, projectId] of [
    ['mobile', PROJECT_IDS.MOBILE],
    ['pc', PROJECT_IDS.PC]
  ]) {
    console.log(`\n2. 주간보고서 생성 (${platform})`);
    try {
      const buffer = await weeklyReportService.generateWeeklyReportFromExcel(
        dailyPath,
        START_DATE,
        END_DATE,
        projectId
      );
      if (!buffer || buffer.length === 0) {
        totalErrors.push({ platform, error: '생성된 버퍼가 비어 있음' });
        continue;
      }
      testsRun += 1;
      const { errors, sheetNames } = await assertNoTemplateResidue(buffer, platform);
      if (errors.length > 0) {
        totalErrors.push(...errors.map(e => ({ platform, ...e })));
      }
      console.log(`   시트: ${sheetNames.join(', ')}`);
      console.log(`   템플릿 잔존 검사: ${errors.length === 0 ? '통과' : '실패 ' + errors.length + '건'}`);
    } catch (e) {
      console.error(`   생성/검사 오류:`, e.message);
      totalErrors.push({ platform, error: e.message });
    }
  }

  try {
    if (fs.existsSync(dailyPath)) fs.unlinkSync(dailyPath);
  } catch (_) {}

  console.log('\n--- 결과 ---');
  if (totalErrors.length === 0) {
    console.log('전체 통과: 템플릿 데이터가 마지막까지 삭제되었고, 데이터 영역 이후 빈 칸만 존재합니다.');
    process.exit(0);
  }
  console.log('실패:', totalErrors.length, '건');
  totalErrors.forEach((err, i) => {
    console.log(`  [${i + 1}] ${err.platform || ''} ${err.region || ''} ${err.sheet || ''}: ${err.error}`);
    if (err.samples && err.samples.length) {
      err.samples.forEach(s => console.log(`       행=${s.row} 열=${s.col} 값="${s.value}"`));
    }
  });
  process.exit(1);
}

run().catch((err) => {
  console.error('테스트 실행 중 오류:', err);
  process.exit(1);
});
