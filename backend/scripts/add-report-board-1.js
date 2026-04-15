/**
 * PUBG PC 자유게시판(menus/1)을 MonitoredBoard에 추가
 * - 배틀그라운드 공식 카페(28866679) 자유게시판
 * - Naver Cafe 워커가 크롤링하여 RawLog에 저장 → ReportItemIssue 승격
 *
 * 실행:
 *   cd backend && node scripts/add-report-board-1.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { queryOne, execute, query } = require('../libs/db');

// 리스트형 DOM 파싱을 위해 viewType=L 사용
const REPORT_BOARD_LIST_URL = 'https://cafe.naver.com/f-e/cafes/28866679/menus/1?viewType=L';
const REPORT_BOARD_NAME = '✒️┃자유게시판';
const CAFE_GAME = 'PUBG_PC';
const PROJECT_ID_PUBG_PC = 1;

// menus/0과 동일한 스캔 주기(낮은 부하)
const INTERVAL_SEC = 150;

function main() {
  const existing = queryOne(
    'SELECT id, name, listUrl FROM MonitoredBoard WHERE listUrl = ?',
    [REPORT_BOARD_LIST_URL]
  );

  if (existing) {
    console.log('✅ 자유게시판(1)이 이미 등록되어 있습니다.');
    console.log(`   ID: ${existing.id}, name: ${existing.name}`);
    console.log(`   listUrl: ${existing.listUrl}`);
    return;
  }

  execute(
    `INSERT INTO MonitoredBoard
      (cafeGame, listUrl, name, url, enabled, isActive, interval, checkInterval, projectId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, datetime('now'), datetime('now'))`,
    [CAFE_GAME, REPORT_BOARD_LIST_URL, REPORT_BOARD_NAME, REPORT_BOARD_LIST_URL, INTERVAL_SEC, INTERVAL_SEC, PROJECT_ID_PUBG_PC]
  );

  const row = queryOne(
    'SELECT id, name, listUrl FROM MonitoredBoard WHERE listUrl = ?',
    [REPORT_BOARD_LIST_URL]
  );

  if (!row) {
    throw new Error('Failed to insert menus/1 monitored board');
  }

  console.log('✅ 자유게시판(1) 모니터링 대상에 추가했습니다.');
  console.log(`   ID: ${row.id}, name: ${row.name}`);
  console.log(`   listUrl: ${row.listUrl}`);
  console.log('\n일일 게시글 수는 다음 스크립트로 조회할 수 있습니다:');
  console.log(`   node scripts/board-daily-post-count.js ${row.id}`);
}

main();

