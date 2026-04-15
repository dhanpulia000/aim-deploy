ALTER TABLE WorkChecklistItem ADD COLUMN workType TEXT DEFAULT '전체';
CREATE INDEX IF NOT EXISTS idx_work_checklist_item_work_type ON WorkChecklistItem(workType);
