#!/usr/bin/env node
/**
 * Mobile 주간보고서 1회 생성 후 프로젝트 루트에 저장 (비교용)
 * 사용법: cd backend && node scripts/generate-mobile-for-compare.js
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const backendRoot = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendRoot, '.env') });
const weeklyReportService = require(path.join(backendRoot, 'services', 'weeklyReport.service'));

const PROJECT_IDS = { MOBILE: 2 };
const START = '2026-01-20';
const END = '2026-01-26';
const tmpDir = path.join(backendRoot, 'tmp');
const dailyPath = path.join(tmpDir, 'daily-for-compare.xlsx');
const outPath = path.join(backendRoot, '..', 'mobile_weekly_generated_for_compare.xlsx');

function createMinimalDaily() {
  const wb = new ExcelJS.Workbook();
  const voc = wb.addWorksheet('VoC');
  voc.getRow(1).values = ['', '날짜', '플랫폼', '내용', '성향', '대분류', '중분류', '출처', '종류', '중요도', '판단/확인사항', '근무', '비고', '링크'];
  voc.getRow(2).values = ['', START, 'Steam', '테스트 VoC', '부정', '버그', '버그', '디스코드', '일반', '', '', '', '', ''];
  voc.getRow(3).values = ['', END, 'Steam', '테스트 VoC2', '긍정', '게임 플레이 관련 문의', '클래식', '디스코드', '일반', '', '', '', '', ''];
  const issue = wb.addWorksheet('Issue');
  issue.getRow(1).values = ['날짜', '요약', '세부 내용', '분류', '공유시간', '공유방식', '성향'];
  issue.getRow(2).values = [START, '테스트 이슈', '세부', '버그', new Date(), '슬랙', '부정'];
  return wb.xlsx.writeFile(dailyPath);
}

async function run() {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  await createMinimalDaily();
  const buf = await weeklyReportService.generateWeeklyReportFromExcel(dailyPath, START, END, PROJECT_IDS.MOBILE);
  fs.writeFileSync(outPath, buf);
  console.log('Saved:', outPath);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
