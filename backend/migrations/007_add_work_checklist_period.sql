ALTER TABLE WorkChecklistItem ADD COLUMN validFrom TEXT;
ALTER TABLE WorkChecklistItem ADD COLUMN validTo TEXT;
ALTER TABLE WorkChecklistItem ADD COLUMN monthsOfYear TEXT;
CREATE INDEX IF NOT EXISTS idx_work_checklist_item_valid_from ON WorkChecklistItem(validFrom);
CREATE INDEX IF NOT EXISTS idx_work_checklist_item_valid_to ON WorkChecklistItem(validTo);
