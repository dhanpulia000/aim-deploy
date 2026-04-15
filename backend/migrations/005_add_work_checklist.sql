CREATE TABLE IF NOT EXISTS WorkChecklistItem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS WorkChecklistExecution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  itemId INTEGER NOT NULL,
  workDate TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  checkedAt TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(userId, itemId, workDate),
  FOREIGN KEY (userId) REFERENCES User(id),
  FOREIGN KEY (itemId) REFERENCES WorkChecklistItem(id)
);

CREATE INDEX IF NOT EXISTS idx_work_checklist_item_active ON WorkChecklistItem(isActive);
CREATE INDEX IF NOT EXISTS idx_work_checklist_item_sort ON WorkChecklistItem(sortOrder);
CREATE INDEX IF NOT EXISTS idx_work_checklist_execution_user_date ON WorkChecklistExecution(userId, workDate);
CREATE INDEX IF NOT EXISTS idx_work_checklist_execution_item ON WorkChecklistExecution(itemId);
