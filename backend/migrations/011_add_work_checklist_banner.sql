-- 업무 체크리스트 상단 알림글 (관리자 작성, 에이전트 화면 상단 고정 노출)
CREATE TABLE IF NOT EXISTS WorkChecklistBanner (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO WorkChecklistBanner (id, content, updatedAt) VALUES (1, NULL, datetime('now'));
