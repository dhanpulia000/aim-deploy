-- 업무 체크리스트: 작업 구분(주간·야간·PC 등)별 담당 에이전트(User) 지정
CREATE TABLE IF NOT EXISTS WorkChecklistAssignee (
  workType TEXT NOT NULL,
  userId INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workType, userId),
  FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_work_checklist_assignee_workType ON WorkChecklistAssignee(workType);
