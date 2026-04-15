/**
 * 제보 게시판(menus/107)을 MonitoredBoard에 추가
 * - 배틀그라운드 공식 카페(28866679) 제보 게시판
 * - Naver Cafe 워커가 크롤링하여 RawLog에 저장 → 일일 게시글 수 집계 가능
 * 실행: cd backend && node scripts/add-report-board-107.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

// 구형 ArticleList.nhn URL 사용 시 워커가 목록을 정상 파싱함 (f-e/cafes/.../menus/107 은 DOM 구조 상이)
const REPORT_BOARD_LIST_URL = 'https://cafe.naver.com/ArticleList.nhn?search.clubid=28866679&search.menuid=107&search.boardtype=L';
const REPORT_BOARD_NAME = '🚨┃제보 게시판';
const CAFE_GAME = 'PUBG_PC';
const PROJECT_ID_PUBG_PC = 1;

function main() {
  const existing = queryOne(
    'SELECT id, name, listUrl FROM MonitoredBoard WHERE listUrl = ?',
    [REPORT_BOARD_LIST_URL]
  );

  if (existing) {
    console.log('✅ 제보 게시판(107)이 이미 등록되어 있습니다.');
    console.log(`   ID: ${existing.id}, name: ${existing.name}, listUrl: ${existing.listUrl}`);
    return;
  }

  execute(
    `INSERT INTO MonitoredBoard (cafeGame, listUrl, name, url, enabled, isActive, interval, checkInterval, projectId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, 1, 300, 300, ?, datetime('now'), datetime('now'))`,
    [CAFE_GAME, REPORT_BOARD_LIST_URL, REPORT_BOARD_NAME, REPORT_BOARD_LIST_URL, PROJECT_ID_PUBG_PC]
  );

  const row = queryOne('SELECT id, name, listUrl FROM MonitoredBoard WHERE listUrl = ?', [REPORT_BOARD_LIST_URL]);
  console.log('✅ 제보 게시판(107)을 모니터링 대상에 추가했습니다.');
  console.log(`   ID: ${row.id}, name: ${row.name}`);
  console.log(`   listUrl: ${row.listUrl}`);
  console.log('\n일일 게시글 수는 다음 스크립트로 조회할 수 있습니다:');
  console.log(`   node scripts/board-daily-post-count.js ${row.id}`);
  logger.info('[AddReportBoard] Report board 107 added', { boardId: row.id });
}

main();
