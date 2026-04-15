/**
 * 인수인계 내역 서비스
 * - 누구나(로그인 사용자) 작성·조회 가능
 */

const { query, queryOne, execute, getDatabase } = require('../libs/db');
const logger = require('../utils/logger');

const WORK_TYPES = ['주간', '오후', '야간', '정오'];

function ensureTable() {
  const { tableExists } = require('../libs/db');
  if (tableExists('HandoverRecord')) return;

  const u = process.env.DATABASE_URL || '';
  if (/^postgres/i.test(u)) {
    throw new Error(
      'HandoverRecord 테이블이 없습니다. PostgreSQL에서는 backend 에서 `npx prisma migrate deploy` 후 다시 시도하세요.'
    );
  }

  logger.info('[Handover] Creating HandoverRecord table');
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS HandoverRecord (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workDate TEXT NOT NULL,
      workType TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      authorId TEXT,
      authorName TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(workDate, workType)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_handover_work_date ON HandoverRecord(workDate)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_handover_work_type ON HandoverRecord(workType)');
}

function listRecords(options = {}) {
  ensureTable();
  const { workDate, workType, startDate, endDate } = options;

  let sql = 'SELECT * FROM HandoverRecord WHERE 1=1';
  const params = [];

  if (workDate) {
    sql += ' AND workDate = ?';
    params.push(workDate);
  }
  if (workType && WORK_TYPES.includes(workType)) {
    sql += ' AND workType = ?';
    params.push(workType);
  }
  if (startDate) {
    sql += ' AND workDate >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND workDate <= ?';
    params.push(endDate);
  }

  sql += ' ORDER BY workDate DESC, CASE workType WHEN \'주간\' THEN 1 WHEN \'오후\' THEN 2 WHEN \'야간\' THEN 3 WHEN \'정오\' THEN 4 ELSE 5 END';

  return query(sql, params);
}

function getRecord(workDate, workType) {
  ensureTable();
  return queryOne('SELECT * FROM HandoverRecord WHERE workDate = ? AND workType = ?', [workDate, workType]);
}

function upsertRecord(data) {
  ensureTable();
  const { workDate, workType, content, authorId, authorName } = data;

  if (!workDate || !workType || !WORK_TYPES.includes(workType)) {
    throw new Error('Invalid workDate or workType');
  }

  const existing = getRecord(workDate, workType);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (existing) {
    execute(
      `UPDATE HandoverRecord SET content = ?, authorId = ?, authorName = ?, updatedAt = ? 
       WHERE workDate = ? AND workType = ?`,
      [String(content || '').trim(), authorId || null, authorName || null, now, workDate, workType]
    );
    return queryOne('SELECT * FROM HandoverRecord WHERE workDate = ? AND workType = ?', [workDate, workType]);
  } else {
    const result = execute(
      `INSERT INTO HandoverRecord (workDate, workType, content, authorId, authorName, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [workDate, workType, String(content || '').trim(), authorId || null, authorName || null, now]
    );
    return queryOne('SELECT * FROM HandoverRecord WHERE id = ?', [result.lastInsertRowid]);
  }
}

module.exports = {
  listRecords,
  getRecord,
  upsertRecord,
  WORK_TYPES
};
