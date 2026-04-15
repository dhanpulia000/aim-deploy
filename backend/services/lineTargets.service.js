// LINE chat target (group/room/user) storage service

const { query, queryOne, execute, executeTransaction, safeQuery } = require('../libs/db');
const logger = require('../utils/logger');

let _schemaEnsured = false;
function ensureLineChatTargetSchema() {
  if (_schemaEnsured) return;
  if (/^postgres/i.test(process.env.DATABASE_URL || '')) {
    _schemaEnsured = true;
    return;
  }
  try {
    const cols = query('PRAGMA table_info(LineChatTarget)') || [];
    const existing = new Set(cols.map((c) => c.name));
    if (!existing.has('displayName')) {
      execute('ALTER TABLE LineChatTarget ADD COLUMN displayName TEXT');
      logger.info('[LineChatTarget] Schema migrated', { addedColumn: 'displayName' });
    }
  } catch (e) {
    logger.warn('[LineChatTarget] Failed to ensure schema (will continue)', { error: e.message });
  } finally {
    _schemaEnsured = true;
  }
}

async function listTargets(options = {}) {
  ensureLineChatTargetSchema();
  const { type } = options;
  return safeQuery(() => {
    let sql = 'SELECT * FROM LineChatTarget WHERE 1=1';
    const params = [];
    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY lastSeenAt DESC';
    return query(sql, params);
  }, []);
}

async function upsertTarget(target) {
  ensureLineChatTargetSchema();
  const { type, targetId, name, lastSeenAt } = target;
  if (!type || !targetId) return;

  return executeTransaction(() => {
    const existing = queryOne(
      'SELECT id FROM LineChatTarget WHERE type = ? AND targetId = ?',
      [type, targetId]
    );
    const now = new Date().toISOString();
    const lastSeen = lastSeenAt || now;

    if (existing?.id) {
      execute(
        'UPDATE LineChatTarget SET name = COALESCE(?, name), lastSeenAt = ?, updatedAt = ? WHERE id = ?',
        [name || null, lastSeen, now, existing.id]
      );
      return existing.id;
    }

    const { nanoid } = require('nanoid');
    const id = nanoid();
    execute(
      `INSERT INTO LineChatTarget (id, type, targetId, name, lastSeenAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, type, targetId, name || null, lastSeen, now, now]
    );
    logger.info('[LineChatTarget] New target discovered', { type, targetId });
    return id;
  });
}

async function updateDisplayName(id, displayName) {
  ensureLineChatTargetSchema();
  const existing = queryOne('SELECT * FROM LineChatTarget WHERE id = ?', [id]);
  if (!existing) return null;
  const now = new Date().toISOString();
  const val = displayName && String(displayName).trim() ? String(displayName).trim() : null;
  execute('UPDATE LineChatTarget SET displayName = ?, updatedAt = ? WHERE id = ?', [val, now, id]);
  return queryOne('SELECT * FROM LineChatTarget WHERE id = ?', [id]);
}

module.exports = {
  listTargets,
  upsertTarget,
  updateDisplayName
};

