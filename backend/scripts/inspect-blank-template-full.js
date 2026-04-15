#!/usr/bin/env node
/**
 * 빈 템플릿 전체 내용 스캔
 * - 시트별 행/열 수, 값이 있는 셀 개수, 값이 있는 행 목록
 *
 * 사용법: node scripts/inspect-blank-template-full.js [pc|mobile|both]
 * 기본: both (PC + Mobile 빈 템플릿 모두)
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const AIM_ROOT = path.resolve(__dirname, '../..');
const FILES = {
  pc: path.join(AIM_ROOT, 'PUBG PC 모니터링 주간 보고서 - 빈.xlsx'),
  mobile: path.join(AIM_ROOT, 'PUBG MOBILE 모니터링 주간 보고서 - 빈.xlsx')
};

function cellStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim().slice(0, 40);
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object' && v.text != null) return String(v.text).trim().slice(0, 40);
  return String(v).slice(0, 40);
}

function hasValue(cell) {
  const s = cellStr(cell && cell.value);
  return s.length > 0;
}

async function inspectOne(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`\n[${label}] 파일 없음: ${filePath}\n`);
    return;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  console.log('\n' + '='.repeat(70));
  console.log(`${label}: ${path.basename(filePath)}`);
  console.log('='.repeat(70));

  for (const sheet of wb.worksheets) {
    const rowCount = sheet.rowCount || 0;
    const colCount = sheet.columnCount || 0;
    const maxR = Math.min(rowCount || 1000, 600);
    const maxC = Math.min(colCount || 30, 25);

    const rowsWithData = [];
    let cellCount = 0;
    const sampleCells = [];

    for (let r = 1; r <= maxR; r++) {
      const row = sheet.getRow(r);
      let rowHasData = false;
      for (let c = 1; c <= maxC; c++) {
        const cell = row.getCell(c);
        if (hasValue(cell)) {
          cellCount++;
          rowHasData = true;
          if (sampleCells.length < 30) {
            sampleCells.push({ r, c, v: cellStr(cell.value) });
          }
        }
      }
      if (rowHasData) rowsWithData.push(r);
    }

    console.log(`\n--- 시트: ${sheet.name} ---`);
    console.log(`  행 수: ${rowCount || '-'}, 열 수: ${colCount || '-'}`);
    console.log(`  값 있는 셀 수: ${cellCount} (스캔 범위 1~${maxR}행, 1~${maxC}열)`);
    if (rowsWithData.length > 0) {
      const list = rowsWithData.length <= 50
        ? rowsWithData.join(', ')
        : rowsWithData.slice(0, 30).join(', ') + ` ... 외 ${rowsWithData.length - 30}행`;
      console.log(`  값 있는 행: ${list}`);
      if (sampleCells.length > 0) {
        console.log(`  샘플 셀 (최대 30개):`);
        sampleCells.forEach(({ r, c, v }) => console.log(`    R${r} C${c}: "${v}"`));
      }
    } else {
      console.log(`  값 있는 행: 없음 (완전 비어 있음)`);
    }
  }
  console.log('');
}

async function run() {
  const which = (process.argv[2] || 'both').toLowerCase();
  console.log('빈 템플릿 전체 내용 검사');

  if (which === 'both' || which === 'pc') {
    await inspectOne(FILES.pc, 'PC');
  }
  if (which === 'both' || which === 'mobile') {
    await inspectOne(FILES.mobile, 'Mobile');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
