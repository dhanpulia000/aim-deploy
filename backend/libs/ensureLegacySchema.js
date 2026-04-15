/**
 * 오래된 SQLite DB에서 누락된 컬럼 보정 (마이그레이션 파싱/문법 이슈 대비)
 */
const { getDatabase } = require('./db');
const logger = require('../utils/logger');

function usePostgres() {
  const u = process.env.DATABASE_URL || '';
  return /^postgres/i.test(u);
}

function ensureCustomerFeedbackNoticeColumns() {
  if (usePostgres()) return;
  try {
    const db = getDatabase();
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='CustomerFeedbackNotice'")
      .get();
    if (!exists) return;

    const cols = db.prepare('PRAGMA table_info(CustomerFeedbackNotice)').all();
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('title')) {
      db.exec("ALTER TABLE CustomerFeedbackNotice ADD COLUMN title TEXT DEFAULT ''");
      logger.info('[LegacySchema] Added CustomerFeedbackNotice.title');
    }
    if (!names.has('endedAt')) {
      db.exec('ALTER TABLE CustomerFeedbackNotice ADD COLUMN endedAt DATETIME');
      logger.info('[LegacySchema] Added CustomerFeedbackNotice.endedAt');
    }
  } catch (e) {
    logger.warn('[LegacySchema] CustomerFeedbackNotice column ensure failed', { error: e.message });
  }
}

/** WorkChecklistItem: showInPC / showInMO (016 마이그레이션 미적용·실패 환경 대비) */
function ensureWorkChecklistItemShowInColumns() {
  if (usePostgres()) return;
  try {
    const db = getDatabase();
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='WorkChecklistItem'")
      .get();
    if (!exists) return;

    const colNames = () =>
      new Set(db.prepare('PRAGMA table_info(WorkChecklistItem)').all().map((c) => c.name));
    let names = colNames();
    if (!names.has('showInPC')) {
      db.exec('ALTER TABLE WorkChecklistItem ADD COLUMN showInPC INTEGER DEFAULT 0');
      logger.info('[LegacySchema] Added WorkChecklistItem.showInPC');
      db.exec("UPDATE WorkChecklistItem SET showInPC = 1 WHERE workType = 'PC'");
    }
    names = colNames();
    if (!names.has('showInMO')) {
      db.exec('ALTER TABLE WorkChecklistItem ADD COLUMN showInMO INTEGER DEFAULT 0');
      logger.info('[LegacySchema] Added WorkChecklistItem.showInMO');
      db.exec("UPDATE WorkChecklistItem SET showInMO = 1 WHERE workType = 'MO'");
    }
  } catch (e) {
    logger.warn('[LegacySchema] WorkChecklistItem showInPC/showInMO ensure failed', { error: e.message });
  }
}

module.exports = {
  ensureCustomerFeedbackNoticeColumns,
  ensureWorkChecklistItemShowInColumns,
};
