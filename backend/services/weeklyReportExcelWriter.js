/**
 * 주간보고서 엑셀 작성: WeeklyReportData만 인자로 받아 지정된 셀에 값 기입 + 스타일(병합, 배경 등)만 적용
 * - 비즈니스 로직/집계/AI 호출 없음
 */

const logger = require('../utils/logger');
const PROJECT_IDS = { PC: 1, MOBILE: 2 };

const LIST_CELL_STYLE = {
  font: { name: '맑은 고딕', size: 10 },
  alignment: { vertical: 'top', horizontal: 'left', wrapText: true }
};

/**
 * @param {import('exceljs').Workbook} templateWb - 이미 로드된 템플릿 워크북
 * @param {Object} data - WeeklyReportData (weeklyReportData.buildWeeklyReportData 반환값)
 * @param {Object} [options] - { copyCellStyleIndependently: function } 등 (서비스에서 주입 가능)
 */
async function writeWeeklyReportToExcel(templateWb, data, options = {}) {
  const { meta, mainSheet, issueDeltaSheet, sharedIssueSheet, vocSheet } = data;
  if (!meta || !mainSheet) {
    logger.warn('writeWeeklyReportToExcel: meta or mainSheet missing');
    return;
  }

  const mainSh = templateWb.getWorksheet(meta.mainSheetName) || templateWb.worksheets.find(s => s.name.includes('주차')) || templateWb.worksheets[0];
  if (!mainSh) return;

  let authorName = meta.authorName;
  if (authorName == null || authorName === '') {
    try {
      const v = mainSh.getCell('L4').value;
      authorName = (typeof v === 'string' ? v : (v && v.richText ? v.richText.map(t => t.text || '').join('') : '')) || '';
      if (/^\d{4}[-.]\d{2}[-.]\d{2}\s*~/.test(authorName)) authorName = '';
        else authorName = authorName.trim();
    } catch (_) {}
  }

  // --- 메인 시트: 헤더 ---
  setCell(mainSh, 2, 2, mainSheet.b2Value);
  setCell(mainSh, 4, meta.dateCol ?? 8, meta.dateRangeText);
  setCellAddr(mainSh, 'K4', '작성자');
  setCellAddr(mainSh, 'L4', authorName || '');
  setCellAddr(mainSh, 'C4', meta.platformLabel);
  setCellAddr(mainSh, 'D4', meta.platformLabel);

  // --- 메인 시트: Mobile 섹션 제목 ---
  if (mainSheet.sectionTitles && meta.projectId === PROJECT_IDS.MOBILE) {
    (mainSheet.sectionTitles || []).forEach(([row, text]) => {
      setCell(mainSh, row, 2, text);
    });
  }

  // --- 메인 시트: 요약문 (R8, R13 등 — 줄바꿈 \n 포함 순수 문자열) ---
  if (meta.projectId === PROJECT_IDS.PC) {
    if (mainSheet.overallSummary != null) setCellStyle(mainSh, 6, 2, mainSheet.overallSummary, LIST_CELL_STYLE);
    if (mainSheet.bestTrendsText != null) setCellStyle(mainSh, 8, 2, mainSheet.bestTrendsText, LIST_CELL_STYLE);
    if (mainSheet.worstTrendsText != null) setCellStyle(mainSh, 13, 2, mainSheet.worstTrendsText, LIST_CELL_STYLE);
  } else {
    if (mainSheet.negSummaryText != null) setCellStyle(mainSh, 9, 2, mainSheet.negSummaryText, LIST_CELL_STYLE);
    if (mainSheet.posSummaryText != null) setCellStyle(mainSh, 11, 2, mainSheet.posSummaryText, LIST_CELL_STYLE);
    if (mainSheet.negCountText != null) setCell(mainSh, 13, 2, mainSheet.negCountText);
  }

  // --- 메인 시트: Mobile 성향별/이슈별 주간 동향 수 ---
  if (meta.projectId === PROJECT_IDS.MOBILE && mainSheet.mainCountBlocks) {
    const b = mainSheet.mainCountBlocks;
    mainSh.getRow(5).getCell(14).value = b.prevLabel;
    mainSh.getRow(5).getCell(15).value = b.prevSentiment?.pos ?? 0;
    mainSh.getRow(5).getCell(16).value = b.prevSentiment?.neg ?? 0;
    mainSh.getRow(5).getCell(17).value = b.prevSentiment?.neu ?? 0;
    mainSh.getRow(5).getCell(19).value = b.prevLabel;
    mainSh.getRow(5).getCell(20).value = b.prevIssueCounts?.gameplay ?? 0;
    mainSh.getRow(5).getCell(21).value = b.prevIssueCounts?.paid ?? 0;
    mainSh.getRow(5).getCell(22).value = b.prevIssueCounts?.bug ?? 0;
    mainSh.getRow(5).getCell(23).value = b.prevIssueCounts?.server ?? 0;
    mainSh.getRow(5).getCell(24).value = b.prevIssueCounts?.restriction ?? 0;
    mainSh.getRow(5).getCell(25).value = b.prevIssueCounts?.cheat ?? 0;
    mainSh.getRow(5).getCell(26).value = b.prevIssueCounts?.manner ?? 0;
    mainSh.getRow(5).getCell(27).value = b.prevIssueCounts?.community ?? 0;
    mainSh.getRow(6).getCell(14).value = b.currLabel;
    mainSh.getRow(6).getCell(15).value = b.currSentiment?.pos ?? 0;
    mainSh.getRow(6).getCell(16).value = b.currSentiment?.neg ?? 0;
    mainSh.getRow(6).getCell(17).value = b.currSentiment?.neu ?? 0;
    mainSh.getRow(6).getCell(19).value = b.currLabel;
    mainSh.getRow(6).getCell(20).value = b.currIssueCounts?.gameplay ?? 0;
    mainSh.getRow(6).getCell(21).value = b.currIssueCounts?.paid ?? 0;
    mainSh.getRow(6).getCell(22).value = b.currIssueCounts?.bug ?? 0;
    mainSh.getRow(6).getCell(23).value = b.currIssueCounts?.server ?? 0;
    mainSh.getRow(6).getCell(24).value = b.currIssueCounts?.restriction ?? 0;
    mainSh.getRow(6).getCell(25).value = b.currIssueCounts?.cheat ?? 0;
    mainSh.getRow(6).getCell(26).value = b.currIssueCounts?.manner ?? 0;
    mainSh.getRow(6).getCell(27).value = b.currIssueCounts?.community ?? 0;
  }

  // --- 메인 시트: 인게임/커뮤니티 동향 테이블 ---
  if (mainSheet.trendTable && mainSheet.trendTable.rows && mainSheet.trendTable.rows.length) {
    writeTrendTable(mainSh, mainSheet.trendTable, options);
  }

  // --- 주요 이슈 건수 증감 (Mobile) ---
  if (meta.projectId === PROJECT_IDS.MOBILE && issueDeltaSheet) {
    const sh = templateWb.getWorksheet('주요 이슈 건수 증감');
    if (sh) {
      sh.getRow(5).getCell(3).value = issueDeltaSheet.prevTotal;
      sh.getRow(5).getCell(6).value = issueDeltaSheet.currTotal;
      (issueDeltaSheet.rows || []).forEach((row, idx) => {
        const r = sh.getRow(8 + idx);
        r.getCell(1).value = row.rank;
        r.getCell(2).value = row.title;
        r.getCell(3).value = row.summary;
        r.getCell(4).value = row.prev;
        r.getCell(5).value = row.curr;
        r.getCell(6).value = row.prevRate;
        r.getCell(7).value = row.currRate;
        r.getCell(8).value = row.diff;
        r.getCell(9).value = row.diffRate;
        r.getCell(10).value = row.diffRate;
      });
    }
  }

  // --- 공유 이슈 시간 순 (Mobile) ---
  if (meta.projectId === PROJECT_IDS.MOBILE && sharedIssueSheet) {
    const sh = templateWb.getWorksheet('공유 이슈 시간 순');
    if (sh) {
      try { sh.getRow(2).getCell(13).value = `${sharedIssueSheet.count}건`; } catch (_) {}
      (sharedIssueSheet.rows || []).forEach((item, idx) => {
        const row = sh.getRow(3 + idx);
        for (let c = 1; c <= 12; c++) row.getCell(c).value = item.line;
      });
    }
  }

  // --- VoC 시트 (Mobile) ---
  if (meta.projectId === PROJECT_IDS.MOBILE && vocSheet) {
    const sh = templateWb.getWorksheet('VoC');
    if (sh) {
      const rows = vocSheet.rows || [];
      rows.forEach((v, i) => {
        const row = sh.getRow(5 + i);
        row.getCell(1).value = v.date || '';
        row.getCell(2).value = v.source || '';
        row.getCell(3).value = v.categoryGroup || '';
        row.getCell(4).value = v.category || '';
        row.getCell(5).value = v.type || '';
        row.getCell(6).value = v.sentiment || '';
        row.getCell(7).value = v.importance || '';
        row.getCell(8).value = v.content || '';
        (v.postUrls || []).slice(0, 10).forEach((u, j) => {
          const cell = row.getCell(9 + j);
          const url = typeof u === 'object' && u && u.url != null ? u.url : String(u || '');
          if (url) cell.value = { text: '1', hyperlink: url };
          else cell.value = '';
        });
      });
      if (vocSheet.summaryRow) {
        sh.getRow(6).getCell(21).value = vocSheet.summaryRow.total;
        sh.getRow(6).getCell(22).value = vocSheet.summaryRow.uniqueGroups;
        sh.getRow(6).getCell(23).value = vocSheet.summaryRow.uniqueCats;
      }
    }
  }
}

function setCell(sheet, row, col, value) {
  const cell = sheet.getCell(row, col);
  if (!cell.formula) cell.value = value != null ? value : '';
}

function setCellAddr(sheet, address, value) {
  const cell = sheet.getCell(address);
  if (!cell.formula) cell.value = value != null ? value : '';
}

function setCellStyle(sheet, row, col, value, style) {
  const cell = sheet.getCell(row, col);
  if (cell.formula) return;
  cell.value = value != null ? String(value) : '';
  if (style && style.font) cell.font = style.font;
  if (style && style.alignment) cell.alignment = style.alignment;
}

function writeTrendTable(sheet, trendTable, options) {
  const { dataStartRow, rows, isPc } = trendTable;
  let currentRow = dataStartRow;
  const style = { font: { size: 10 }, alignment: { vertical: 'top', wrapText: true } };

  for (const row of rows) {
    if (row.rowType === 'section') {
      const cell = sheet.getCell(currentRow, 2);
      if (!cell.formula) { cell.value = row.text || ''; cell.font = style.font; cell.alignment = style.alignment; }
      currentRow++;
    } else if (row.rowType === 'header') {
      const cells = row.cells || [];
      [2, 3, 4].forEach((col, i) => {
        const cell = sheet.getCell(currentRow, col);
        if (!cell.formula) { cell.value = cells[i] ?? (col === 2 ? '분류' : col === 3 ? '플랫폼' : '주제'); cell.font = style.font; cell.alignment = style.alignment; }
      });
      currentRow++;
    } else if (row.rowType === 'topic') {
      const cell = sheet.getCell(currentRow, 2);
      if (!cell.formula) { cell.value = row.text || ''; cell.font = style.font; cell.alignment = style.alignment; }
      currentRow++;
    } else if (row.rowType === 'data') {
      const cells = row.cells || [];
      const rowObj = sheet.getRow(currentRow);
      if (isPc) {
        rowObj.getCell(2).value = cells[0] != null ? String(cells[0]) : '';
        rowObj.getCell(3).value = cells[1] != null ? String(cells[1]) : '';
        const d = rowObj.getCell(4);
        if (!d.formula) { d.value = cells[2] != null ? String(cells[2]) : ''; d.font = style.font; d.alignment = style.alignment; }
        try { sheet.mergeCells(currentRow, 4, currentRow, 5); } catch (_) {}
        const f = rowObj.getCell(6);
        if (!f.formula) { f.value = cells[3] != null ? String(cells[3]) : ''; f.font = style.font; f.alignment = style.alignment; }
        try { sheet.mergeCells(currentRow, 6, currentRow, 15); } catch (_) {}
        if (cells[4]) { rowObj.getCell(16).value = { text: '1', hyperlink: String(cells[4]) }; rowObj.getCell(16).font = style.font; rowObj.getCell(16).alignment = style.alignment; }
      } else {
        rowObj.getCell(2).value = cells[0] != null ? String(cells[0]) : '';
        rowObj.getCell(3).value = cells[1] != null ? String(cells[1]) : '';
        rowObj.getCell(2).font = style.font;
        rowObj.getCell(2).alignment = style.alignment;
        rowObj.getCell(3).font = style.font;
        rowObj.getCell(3).alignment = style.alignment;
      }
      currentRow++;
    }
  }
}

module.exports = {
  writeWeeklyReportToExcel
};
