-- PC / MO 플로팅 영역 표시 여부 (0: 미표시, 1: 표시)
ALTER TABLE WorkChecklistItem ADD COLUMN showInPC INTEGER DEFAULT 0;
ALTER TABLE WorkChecklistItem ADD COLUMN showInMO INTEGER DEFAULT 0;
-- 기존 workType='PC' / 'MO' 항목을 새 컬럼에 반영
UPDATE WorkChecklistItem SET showInPC = 1 WHERE workType = 'PC';
UPDATE WorkChecklistItem SET showInMO = 1 WHERE workType = 'MO';
