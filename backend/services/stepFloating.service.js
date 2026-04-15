/**
 * 스텝 플로팅 서비스
 * - 관리자: 항목 CRUD
 * - 에이전트: 업무 체크리스트 화면에서 조회
 */

const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

function ensureTable() {
  const { tableExists, getDatabase } = require('../libs/db');
  if (tableExists('StepFloating')) return;

  const u = process.env.DATABASE_URL || '';
  if (/^postgres/i.test(u)) {
    throw new Error(
      'StepFloating 테이블이 없습니다. PostgreSQL에서는 backend 디렉터리에서 `npx prisma migrate deploy` 후 다시 시도하세요.'
    );
  }

  logger.info('[StepFloating] Creating StepFloating table');
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS StepFloating (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT 'right',
      sortOrder INTEGER NOT NULL DEFAULT 0,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_step_floating_position ON StepFloating(position)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_step_floating_active ON StepFloating(isActive)');
}

function listItems(options = {}) {
  ensureTable();
  const { includeInactive = false, position } = options;

  let sql = 'SELECT * FROM StepFloating WHERE 1=1';
  const params = [];

  if (!includeInactive) {
    sql += ' AND isActive = 1';
  }
  if (position) {
    sql += ' AND position = ?';
    params.push(position);
  }

  sql += ' ORDER BY position ASC, sortOrder ASC, id ASC';

  return query(sql, params);
}

function getItem(id) {
  ensureTable();
  return queryOne('SELECT * FROM StepFloating WHERE id = ?', [id]);
}

function createItem(data) {
  ensureTable();
  const { title, content, position = 'right', sortOrder = 0 } = data;

  const maxOrder = queryOne('SELECT COALESCE(MAX(sortOrder), 0) as maxOrder FROM StepFloating WHERE position = ?', [position]);
  const order = sortOrder ?? (maxOrder?.maxOrder ?? 0) + 1;

  const result = execute(
    `INSERT INTO StepFloating (title, content, position, sortOrder, isActive, updatedAt)
     VALUES (?, ?, ?, ?, 1, datetime('now'))`,
    [String(title || '').trim(), String(content || '').trim(), position === 'left' ? 'left' : 'right', order]
  );

  return queryOne('SELECT * FROM StepFloating WHERE id = ?', [result.lastInsertRowid]);
}

function updateItem(id, data) {
  ensureTable();
  const existing = queryOne('SELECT * FROM StepFloating WHERE id = ?', [id]);
  if (!existing) return null;

  const updates = [];
  const params = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    params.push(String(data.title).trim());
  }
  if (data.content !== undefined) {
    updates.push('content = ?');
    params.push(String(data.content).trim());
  }
  if (data.position !== undefined) {
    updates.push('position = ?');
    params.push(data.position === 'left' ? 'left' : 'right');
  }
  if (data.sortOrder !== undefined) {
    updates.push('sortOrder = ?');
    params.push(Number(data.sortOrder));
  }
  if (data.isActive !== undefined) {
    updates.push('isActive = ?');
    params.push(data.isActive ? 1 : 0);
  }

  if (updates.length === 0) return existing;

  updates.push("updatedAt = datetime('now')");
  params.push(id);

  execute(`UPDATE StepFloating SET ${updates.join(', ')} WHERE id = ?`, params);
  return queryOne('SELECT * FROM StepFloating WHERE id = ?', [id]);
}

function deleteItem(id) {
  ensureTable();
  const existing = queryOne('SELECT * FROM StepFloating WHERE id = ?', [id]);
  if (!existing) return false;

  execute('DELETE FROM StepFloating WHERE id = ?', [id]);
  logger.info('[StepFloating] Item deleted', { id });
  return true;
}

function reorderItems(orderedIds) {
  ensureTable();
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;

  orderedIds.forEach((id, index) => {
    execute('UPDATE StepFloating SET sortOrder = ?, updatedAt = datetime(\'now\') WHERE id = ?', [index, id]);
  });
  logger.info('[StepFloating] Items reordered', { count: orderedIds.length });
}

module.exports = {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  reorderItems
};
