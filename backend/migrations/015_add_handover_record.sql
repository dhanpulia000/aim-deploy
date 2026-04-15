-- 인수인계 내역 (날짜별, 주간/오후/야간/정오)
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
);

CREATE INDEX IF NOT EXISTS idx_handover_work_date ON HandoverRecord(workDate);
CREATE INDEX IF NOT EXISTS idx_handover_work_type ON HandoverRecord(workType);
