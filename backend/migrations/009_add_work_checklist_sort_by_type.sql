-- 업무구분(workType)별 체크리스트 정렬 저장 테이블
-- - 동일 항목이라도 workType(주간/오후/야간/정오)마다 다른 순서를 가질 수 있음

CREATE TABLE IF NOT EXISTS WorkChecklistItemSortByType (
  workType TEXT NOT NULL,
  itemId INTEGER NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (workType, itemId),
  FOREIGN KEY (itemId) REFERENCES WorkChecklistItem(id)
);

CREATE INDEX IF NOT EXISTS idx_work_checklist_sort_by_type
  ON WorkChecklistItemSortByType(workType, sortOrder);

