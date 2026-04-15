#!/usr/bin/env node
/**
 * 값이 있는 주간보고서 템플릿에서 "데이터 영역"만 비워서 "빈 템플릿" 파일 생성
 *
 * - 헤더, 섹션 제목(■), 수식, 병합/서식은 유지
 * - 데이터가 채워지는 셀만 null로 비움
 *
 * 사용법:
 *   cd backend && node scripts/generate-blank-weekly-templates.js
 *
 * 출력: 프로젝트 루트에
 *   PUBG PC 모니터링 주간 보고서 - 빈.xlsx
 *   PUBG MOBILE 모니터링 주간 보고서 - 빈.xlsx
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const AIM_ROOT = path.resolve(__dirname, '../..');
const TEMPLATE_PC = path.join(AIM_ROOT, 'PUBG PC 모니터링 주간 보고서 - 1월 4주차.xlsx');
const TEMPLATE_MOBILE = path.join(AIM_ROOT, 'PUBG MOBILE 모니터링 주간 보고서 - 1월 4주차.xlsx');
const OUT_PC = path.join(AIM_ROOT, 'PUBG PC 모니터링 주간 보고서 - 빈.xlsx');
const OUT_MOBILE = path.join(AIM_ROOT, 'PUBG MOBILE 모니터링 주간 보고서 - 빈.xlsx');

function cellValueToString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && v.text != null) return String(v.text).trim();
  return String(v).trim();
}

/** 시트에서 "보존할 행" 번호 집합 반환 (■, 분류, 플랫폼, 주제, 동향 N건 등) */
function getPreservedRowsForMainSheet(sheet, startRow, endRow) {
  const preserved = new Set();
  for (let r = startRow; r <= Math.min(endRow, startRow + 200); r++) {
    const row = sheet.getRow(r);
    const bVal = cellValueToString(row.getCell(2).value);
    if (/^■/.test(bVal)) {
      preserved.add(r);
      const nextRow = sheet.getRow(r + 1);
      const nextB = cellValueToString(nextRow.getCell(2).value);
      if (/분류|플랫폼|주제|동향/.test(nextB)) preserved.add(r + 1);
    }
    if (/분류|플랫폼|주제/.test(bVal)) preserved.add(r);
    if (/동향.*\d+건/.test(bVal)) preserved.add(r);
  }
  return preserved;
}

/**
 * ■ 인게임 동향, ■ 컨텐츠 동향 등 섹션 제목 행을 일반 리스트와 동일한 스타일로 변경하고 값 비움
 * - 템플릿 전용 스타일(굵게/배경 등) 제거 → 리스트 행과 동일한 font/alignment 적용
 * - 해당 셀 값은 null로 비워 빈 템플릿으로 만듦 (생성 시 서비스에서 다시 채움)
 */
const LIST_ROW_STYLE = {
  font: { name: '맑은 고딕', size: 10, bold: false },
  alignment: { vertical: 'top', horizontal: 'left', wrapText: true }
};

function applyListStyleToSectionTitleRows(sheet, startRow, endRow, colEnd = 16) {
  let count = 0;
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    const bCell = row.getCell(2);
    const bVal = cellValueToString(bCell.value);
    if (!/^■/.test(bVal)) continue;
    for (let c = 2; c <= colEnd; c++) {
      const cell = row.getCell(c);
      if (cell.formula) continue;
      const isSlave = cell.isMerged && cell.master && cell.address !== cell.master.address;
      if (!isSlave) cell.value = null;
      cell.font = { ...LIST_ROW_STYLE.font };
      cell.alignment = { ...LIST_ROW_STYLE.alignment };
      count++;
    }
  }
  return count;
}

/** 시트의 병합 목록 반환 (model.merges 또는 _merges) */
function getSheetMerges(sheet) {
  const out = [];
  try {
    if (sheet.model && Array.isArray(sheet.model.merges)) {
      sheet.model.merges.forEach((m) => out.push(m));
    }
  } catch (e) { /* ignore */ }
  try {
    if (sheet._merges && typeof sheet._merges === 'object') {
      Object.keys(sheet._merges).forEach((k) => out.push(k));
    }
  } catch (e) { /* ignore */ }
  return out;
}

/** 동향 리스트 내 병합+회색 배경 행을 5개(또는 전체 열) 일반 셀로 분리하고 배경 제거 */
function unmergeAndRemoveGrayInTrendList(sheet, startRow, endRow, colEnd = 16) {
  const targetRows = new Set();
  for (let r = startRow; r <= endRow; r++) {
    const bVal = cellValueToString(sheet.getRow(r).getCell(2).value);
    if (/^■/.test(bVal) || /분류|플랫폼|주제/.test(bVal)) targetRows.add(r);
  }
  if (targetRows.size === 0) return 0;

  let unmergeCount = 0;
  const merges = getSheetMerges(sheet);
  for (const m of merges) {
    const rangeStr = typeof m === 'string' ? m : (m && (m.range || m.ref || String(m))) || '';
    if (!rangeStr || rangeStr.indexOf(':') === -1) continue;
    const [startAddr, endAddr] = rangeStr.split(':');
    const matchStart = startAddr.match(/([A-Z]+)(\d+)/);
    const matchEnd = endAddr.match(/([A-Z]+)(\d+)/);
    if (!matchStart || !matchEnd) continue;
    const r1 = parseInt(matchStart[2], 10);
    const r2 = parseInt(matchEnd[2], 10);
    const overlaps = Array.from(targetRows).some((tr) => tr >= r1 && tr <= r2);
    if (!overlaps) continue;
    try {
      sheet.unmergeCells(rangeStr);
      unmergeCount++;
    } catch (e) { /* ignore */ }
  }

  const noFill = { type: 'pattern', pattern: 'none' };
  let fillCount = 0;
  for (const r of targetRows) {
    const row = sheet.getRow(r);
    for (let c = 2; c <= colEnd; c++) {
      const cell = row.getCell(c);
      if (cell.formula) continue;
      cell.fill = noFill;
      fillCount++;
    }
  }
  return unmergeCount + fillCount;
}

/** 시트의 데이터 영역만 비움 (수식·병합 마스터 제외) */
function clearDataRegion(sheet, startRow, endRow, colStart, colEnd, options = {}) {
  const skipCols = new Set(options.skipCols || []);
  const preservedRows = options.preservedRows || null;
  let cleared = 0;
  for (let r = startRow; r <= endRow; r++) {
    if (preservedRows && preservedRows.has(r)) continue;
    const row = sheet.getRow(r);
    for (let c = colStart; c <= colEnd; c++) {
      if (skipCols.has(c)) continue;
      const cell = row.getCell(c);
      if (cell.formula) continue;
      if (cell.isMerged && cell.master && cell.address !== cell.master.address) continue;
      cell.value = null;
      cleared++;
    }
  }
  return cleared;
}

/** PC 템플릿 데이터 영역 비우기 */
async function clearPCTemplate(wb) {
  let total = 0;
  const mainSheet = wb.worksheets.find(s => s.name.includes('주차'));
  if (mainSheet) {
    const preserved = getPreservedRowsForMainSheet(mainSheet, 20, 400);
    total += clearDataRegion(mainSheet, 26, 600, 1, 16, { preservedRows: preserved });
  }
  const community = wb.getWorksheet('커뮤니티 일반');
  if (community) {
    total += clearDataRegion(community, 6, 1000, 2, 23);
  }
  const antiCheat = wb.getWorksheet('안티치트_INDEX');
  if (antiCheat) {
    total += clearDataRegion(antiCheat, 7, 650, 2, 16);
  }
  const reportBoard = wb.getWorksheet('제보게시판');
  if (reportBoard) {
    total += clearDataRegion(reportBoard, 3, 1000, 2, 20);
  }
  return total;
}

/** Mobile 템플릿 데이터 영역 비우기 */
async function clearMobileTemplate(wb) {
  let total = 0;
  const voc = wb.getWorksheet('VoC');
  if (voc) {
    total += clearDataRegion(voc, 5, 2500, 1, 30);
  }
  const sharedIssue = wb.getWorksheet('공유 이슈 시간 순');
  if (sharedIssue) {
    total += clearDataRegion(sharedIssue, 3, 500, 1, 12);
  }
  const issueDelta = wb.getWorksheet('주요 이슈 건수 증감');
  if (issueDelta) {
    total += clearDataRegion(issueDelta, 5, 120, 1, 10);
  }
  const mainSheet = wb.worksheets.find(s => s.name.includes('주차'));
  if (mainSheet) {
    const preserved = getPreservedRowsForMainSheet(mainSheet, 10, 400);
    total += clearDataRegion(mainSheet, 15, 600, 1, 16, { preservedRows: preserved });
  }
  const dataSheet = wb.getWorksheet('Data');
  if (dataSheet) {
    total += clearDataRegion(dataSheet, 1, 2500, 1, 30);
  }
  return total;
}

/** 명명된 범위 제거 (Excel "제거된 레코드: 명명된 범위" 복구 경고 방지) */
function removeDefinedNames(wb) {
  let removed = 0;
  if (wb.definedNames && wb.definedNames.length > 0) {
    const names = [];
    wb.definedNames.forEach((n) => names.push(n.name));
    names.forEach((name) => {
      try {
        wb.definedNames.remove(name);
        removed++;
      } catch (e) { /* ignore */ }
    });
  }
  if (wb.definedNames && typeof wb.definedNames.model !== 'undefined') {
    wb.definedNames.model = [];
  }
  if (wb.model && wb.model.definedNames) {
    wb.model.definedNames = [];
  }
  return removed;
}

/** 공유 수식 제거 (Shared Formula master/clone 오류 방지) — 먼저 실행 */
function removeSharedFormulas(sheet) {
  let count = 0;
  try {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.sharedFormula || (cell.value && typeof cell.value === 'object' && cell.value.sharedFormula)) {
          const result = (cell.value && cell.value.result != null) ? cell.value.result : '';
          cell.value = result;
          if (cell.sharedFormula) {
            delete cell.sharedFormula;
            cell.sharedFormula = null;
          }
          if (cell.value && typeof cell.value === 'object' && cell.value.sharedFormula) {
            cell.value = result;
          }
          count++;
        }
      });
    });
  } catch (e) {
    // ignore
  }
  return count;
}

/** 시트 내 수식을 계산값으로 치환 (Excel "제거된 레코드: 수식" / "복구된 레코드: 셀 정보" 방지) */
function replaceFormulasWithValues(sheet) {
  let count = 0;
  try {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
          const result = cell.value.result != null ? cell.value.result : '';
          cell.value = result;
          count++;
        }
      });
    });
  } catch (e) {
    // ignore
  }
  return count;
}

async function run() {
  console.log('=== 빈 주간보고서 템플릿 생성 ===\n');

  for (const [label, templatePath, outPath, clearFn] of [
    ['PC', TEMPLATE_PC, OUT_PC, clearPCTemplate],
    ['Mobile', TEMPLATE_MOBILE, OUT_MOBILE, clearMobileTemplate]
  ]) {
    if (!fs.existsSync(templatePath)) {
      console.log(`[${label}] 템플릿 없음: ${templatePath}`);
      continue;
    }
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(templatePath);

      // 1. 템플릿 메타데이터 초기화 (Corruption Fix): 명명된 범위·자동필터 제거
      if (wb.definedNames && typeof wb.definedNames.model !== 'undefined') {
        wb.definedNames.model = [];
      }
      if (wb.model && wb.model.definedNames) {
        wb.model.definedNames = [];
      }
      wb.worksheets.forEach((sheet) => {
        if (sheet.autoFilter != null) sheet.autoFilter = null;
      });

      // 공유 수식 먼저 제거 (데이터 클리어 시 master 제거로 clone만 남아 오류 나는 것 방지)
      let sharedRemoved = 0;
      wb.worksheets.forEach((sheet) => {
        sharedRemoved += removeSharedFormulas(sheet);
      });
      const namesRemoved = removeDefinedNames(wb);
      let formulasReplaced = 0;
      wb.worksheets.forEach((sheet) => {
        formulasReplaced += replaceFormulasWithValues(sheet);
      });

      const cleared = await clearFn(wb);

      // ■ 인게임 동향, ■ 컨텐츠 동향 등 섹션 제목 행 → 일반 리스트와 동일 스타일로 변경 후 값 비움
      // Mobile은 상단(5,8,10,12행 등)에도 ■ 주간 동향 수, ■ 부정/긍정 요약 등이 있으므로 1행부터 적용
      let listStyleApplied = 0;
      let unmergeGrayCount = 0;
      const mainSheet = wb.worksheets.find(s => s.name.includes('주차'));
      if (mainSheet) {
        const trendStartRow = label === 'Mobile' ? 1 : 24;
        listStyleApplied = applyListStyleToSectionTitleRows(mainSheet, trendStartRow, 500, 16);
        // 동향 리스트 내 병합+회색 배경 행 → 5개 일반 셀로 분리, 배경 제거
        unmergeGrayCount = unmergeAndRemoveGrayInTrendList(mainSheet, trendStartRow, 500, 16);
      }

      await wb.xlsx.writeFile(outPath);
      console.log(`[${label}] 완료: ${path.basename(outPath)} (비운 셀: ${cleared}, 섹션행→리스트스타일: ${listStyleApplied}, 병합해제·배경제거: ${unmergeGrayCount}, 명명된 범위: ${namesRemoved}, 공유수식 제거: ${sharedRemoved}, 수식→값: ${formulasReplaced})`);
    } catch (e) {
      console.error(`[${label}] 오류:`, e.message);
    }
  }

  console.log('\n주간보고서 서비스는 빈 템플릿이 있으면 자동으로 사용합니다.');
  console.log('Excel "제거된/복구된 레코드" 경고 방지를 위해 명명된 범위·수식은 빈 템플릿에서 제거됩니다.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
