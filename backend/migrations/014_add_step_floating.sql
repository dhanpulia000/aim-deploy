-- 업무 체크리스트 화면 사이드 스텝 플로팅 (관리자 등록, 에이전트 조회)
CREATE TABLE IF NOT EXISTS StepFloating (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'right',
  sortOrder INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_step_floating_position ON StepFloating(position);
CREATE INDEX IF NOT EXISTS idx_step_floating_active ON StepFloating(isActive);
