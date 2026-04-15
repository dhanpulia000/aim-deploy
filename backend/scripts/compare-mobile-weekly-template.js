/* eslint-disable no-console */
/**
 * Compare PUBG MOBILE weekly template vs generated output.
 *
 * Focuses on "error candidates":
 * - object-like cell values that can show up as "[object Object]"
 * - cells where generated equals template "sample" (leftover) in data regions
 * - cells where template has value but generated is blank in data regions
 * - merge differences (count + list)
 *
 * Usage:
 *   node backend/scripts/compare-mobile-weekly-template.js \
 *     --template "/home/young-dev/AIM/PUBG MOBILE 모니터링 주간 보고서 - 1월 4주차.xlsx" \
 *     --generated "/home/young-dev/AIM/mobile_generated_latest.xlsx" \
 *     --out "/home/young-dev/AIM/mobile_compare_report.json"
 */

const path = require('path');
const ExcelJS = require('exceljs');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

const TEMPLATE = argValue('--template');
const GENERATED = argValue('--generated');
const OUT = argValue('--out') || path.join(process.cwd(), 'mobile_compare_report.json');

if (!TEMPLATE || !GENERATED) {
  console.error('Missing required args: --template, --generated');
  process.exit(1);
}

const MAX_ROWS = Number(argValue('--maxRows') || 320);
const MAX_COLS = Number(argValue('--maxCols') || 40);

const STATIC_WHITELIST_PATTERNS = [
  /Latis Krafton/i,
  /^PUBG\s*MOBILE$/i,
  /모니터링\s*주간\s*보고서/i,
  /^대상$/,
  /데이터\s*취합\s*기간/,
  /성향별\s*주간\s*동향\s*수/,
  /이슈\s*별\s*동향\s*수/,
  /^긍정$/,
  /^부정$/,
  /^중립$/,
  /^주차$/,
  /WEEKLY SUMMARY DATA/i,
  /^VoC$/i,
  /^Data$/i,
  /게시물\s*주소/,
  /출처/,
  /대분류/,
  /중분류/,
  /종류/,
  /성향/,
  /중요도/,
  /^내용$/,
  /순위/,
  /주요\s*이슈/,
  /건수/,
  /비율/,
  /증감/,
  /MO/,
];

function isBlank(v) {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function getCellText(cell) {
  const v = cell ? cell.value : null;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') {
    // ExcelJS richText
    if (Array.isArray(v.richText)) {
      return v.richText.map(t => t?.text || '').join('');
    }
    // hyperlink
    if (v.text && v.hyperlink) return String(v.text);
    // formula/result objects
    if (Object.prototype.hasOwnProperty.call(v, 'formula')) {
      if (v.result != null) return String(v.result);
      return '';
    }
    // fallback: avoid "[object Object]" becoming invisible
    try {
      return JSON.stringify(v);
    } catch (e) {
      return String(v);
    }
  }
  return String(v);
}

function looksStaticHeader(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return STATIC_WHITELIST_PATTERNS.some(re => re.test(s));
}

function mergesOf(sheet) {
  // ExcelJS stores merges in model.merges or worksheet._merges (map)
  const out = new Set();
  try {
    if (sheet.model && Array.isArray(sheet.model.merges)) {
      sheet.model.merges.forEach(m => out.add(m));
    }
  } catch (e) {
    // ignore
  }
  try {
    if (sheet._merges) {
      Object.keys(sheet._merges).forEach(k => out.add(k));
    }
  } catch (e) {
    // ignore
  }
  return Array.from(out).sort();
}

async function main() {
  const templateWb = new ExcelJS.Workbook();
  const generatedWb = new ExcelJS.Workbook();
  await templateWb.xlsx.readFile(TEMPLATE);
  await generatedWb.xlsx.readFile(GENERATED);

  const templateSheets = templateWb.worksheets.map(s => s.name);
  const generatedSheets = generatedWb.worksheets.map(s => s.name);

  const report = {
    template: TEMPLATE,
    generated: GENERATED,
    maxRows: MAX_ROWS,
    maxCols: MAX_COLS,
    generatedOnlySheets: generatedSheets.filter(n => !templateSheets.includes(n)),
    missingSheets: templateSheets.filter(n => !generatedSheets.includes(n)),
    perSheet: [],
  };

  for (const name of templateSheets) {
    const tSh = templateWb.getWorksheet(name);
    const gSh = generatedWb.getWorksheet(name);
    if (!tSh || !gSh) continue;

    const tMerges = mergesOf(tSh);
    const gMerges = mergesOf(gSh);
    const mergeDiff = {
      templateCount: tMerges.length,
      generatedCount: gMerges.length,
      onlyInTemplate: tMerges.filter(m => !gMerges.includes(m)).slice(0, 200),
      onlyInGenerated: gMerges.filter(m => !tMerges.includes(m)).slice(0, 200),
    };

    const objectCells = [];
    const leftoverSample = [];
    const templateNonEmptyGeneratedEmpty = [];

    // Heuristic region: exclude top title rows; most "real data" starts at row >= 5.
    const DATA_ROW_START = 5;

    for (let r = 1; r <= MAX_ROWS; r++) {
      for (let c = 1; c <= MAX_COLS; c++) {
        const tCell = tSh.getRow(r).getCell(c);
        const gCell = gSh.getRow(r).getCell(c);

        const tText = String(getCellText(tCell) || '');
        const gText = String(getCellText(gCell) || '');

        // object-like value detection: keep it simple and explicit
        if (gText.includes('[object Object]')) {
          objectCells.push({ addr: `R${r}C${c}`, value: gText, template: tText });
        }

        // Data region checks
        if (r >= DATA_ROW_START) {
          const tBlank = isBlank(tText);
          const gBlank = isBlank(gText);

          // template has something but generated is blank (often means we cleared too much / didn't fill)
          if (!tBlank && gBlank && !looksStaticHeader(tText)) {
            templateNonEmptyGeneratedEmpty.push({ addr: `R${r}C${c}`, template: tText });
          }

          // generated still equals template in data rows (often means template sample leftover)
          if (!tBlank && !gBlank && tText === gText && !looksStaticHeader(tText)) {
            leftoverSample.push({ addr: `R${r}C${c}`, value: gText });
          }
        }
      }
    }

    report.perSheet.push({
      sheet: name,
      objectCellCount: objectCells.length,
      leftoverSampleCount: leftoverSample.length,
      templateNonEmptyGeneratedEmptyCount: templateNonEmptyGeneratedEmpty.length,
      mergeDiff,
      objectCells: objectCells.slice(0, 200),
      leftoverSample: leftoverSample.slice(0, 200),
      templateNonEmptyGeneratedEmpty: templateNonEmptyGeneratedEmpty.slice(0, 200),
    });
  }

  const fs = require('fs');
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Wrote report: ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

