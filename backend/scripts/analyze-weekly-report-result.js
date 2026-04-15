#!/usr/bin/env node
/**
 * 주간보고서 생성 결과 파일 분석 (특히 201행 근처 템플릿 잔존 확인)
 *
 * 사용법: node scripts/analyze-weekly-report-result.js <결과파일.xlsx>
 * 예: node scripts/analyze-weekly-report-result.js "/home/young-dev/Downloads/weekly_report_from_excel_mobile_2026-01-20_2026-01-26.xlsx"
 */

const path = require('path');
const ExcelJS = require('exceljs');

const filePath = process.argv[2];
if (!filePath) {
  console.log('사용법: node scripts/analyze-weekly-report-result.js <결과파일.xlsx>');
  process.exit(1);
}

function cellStr(cell) {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim().slice(0, 50);
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object' && v.text != null) return String(v.text).trim().slice(0, 50);
  return String(v).slice(0, 50);
}

async function run() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  console.log('=== 주간보고서 결과 파일 분석 ===');
  console.log('파일:', filePath);
  console.log('시트:', wb.worksheets.map(s => s.name).join(', '));
  console.log('');

  const rowRange = { start: 195, end: 215 };

  for (const sheet of wb.worksheets) {
    console.log(`--- 시트: ${sheet.name} ---`);
    const maxCol = Math.min(sheet.columnCount || 20, 16);
    for (let r = rowRange.start; r <= rowRange.end; r++) {
      const row = sheet.getRow(r);
      const parts = [];
      for (let c = 1; c <= maxCol; c++) {
        const s = cellStr(row.getCell(c));
        if (s) parts.push(`C${c}:"${s}"`);
      }
      if (parts.length) {
        console.log(`  R${r}: ${parts.join(' | ')}`);
      }
    }
    console.log('');
  }

  console.log('--- 201행 근처 비어있어야 할 구간 요약 ---');
  for (const sheet of wb.worksheets) {
    let count201 = 0;
    for (let c = 1; c <= 16; c++) {
      const s = cellStr(sheet.getRow(201).getCell(c));
      if (s) count201++;
    }
    if (count201 > 0) {
      console.log(`${sheet.name}: R201에 값 있는 셀 ${count201}개 (템플릿 잔존 의심)`);
    }
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
