/**
 * 게시판별 일일 게시글 수 조회 (RawLog 기준)
 * - boardId에 해당하는 RawLog를 timestamp(원본 작성일) 기준으로 날짜별 COUNT
 * 사용: node scripts/board-daily-post-count.js [boardId] [startDate] [endDate]
 * 예: node scripts/board-daily-post-count.js 6
 *     node scripts/board-daily-post-count.js 6 2026-02-01 2026-02-25
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query, queryOne } = require('../libs/db');

const boardId = process.argv[2];
const startDate = process.argv[3] || null; // YYYY-MM-DD
const endDate = process.argv[4] || null;   // YYYY-MM-DD

if (!boardId) {
  console.log('사용법: node scripts/board-daily-post-count.js <boardId> [startDate] [endDate]');
  console.log('  boardId  : MonitoredBoard.id (예: 6)');
  console.log('  startDate: YYYY-MM-DD (선택)');
  console.log('  endDate  : YYYY-MM-DD (선택)');
  console.log('\n등록된 게시판 목록:');
  const boards = query('SELECT id, name, listUrl FROM MonitoredBoard WHERE enabled = 1 ORDER BY id', []);
  boards.forEach(b => console.log(`  ${b.id}: ${b.name}`));
  process.exit(1);
}

const board = queryOne('SELECT id, name, listUrl FROM MonitoredBoard WHERE id = ?', [boardId]);
if (!board) {
  console.error(`게시판 ID ${boardId}를 찾을 수 없습니다.`);
  process.exit(1);
}

// timestamp는 UTC ISO 저장 → 한국 시간(KST) 기준으로 날짜 집계
const dateExpr = "DATE(datetime(timestamp, '+9 hours'))";
let sql = `
  SELECT ${dateExpr} AS date, COUNT(*) AS count
  FROM RawLog
  WHERE source = 'naver' AND boardId = ?
`;
const params = [boardId];
if (startDate) {
  sql += ` AND ${dateExpr} >= ?`;
  params.push(startDate);
}
if (endDate) {
  sql += ` AND ${dateExpr} <= ?`;
  params.push(endDate);
}
sql += ` GROUP BY ${dateExpr} ORDER BY date DESC LIMIT 90`;

const rows = query(sql, params);

console.log(`\n게시판: ${board.name} (ID: ${board.id})`);
console.log(`기간: ${startDate || '(전체)'} ~ ${endDate || '(전체)'}\n`);
console.log('날짜         일일 게시글 수');
console.log('------------------------');

if (rows.length === 0) {
  console.log('(수집된 데이터 없음. 워커가 한 번이라도 해당 게시판을 스캔한 뒤 다시 조회해 주세요.)');
} else {
  let total = 0;
  rows.forEach(r => {
    console.log(`${r.date}    ${r.count}`);
    total += r.count;
  });
  console.log('------------------------');
  console.log(`합계: ${total}건`);
}

process.exit(0);
