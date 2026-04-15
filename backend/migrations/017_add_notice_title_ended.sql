-- CustomerFeedbackNotice: title, endedAt 추가는 ensureLegacySchema(서버 기동 시 PRAGMA 확인 후 ALTER)에서 처리.
-- (스키마에 이미 컬럼이 있는 DB와 없는 DB가 섞여 있어 순수 SQL 마이그레이션만으로는 안전하지 않음)
SELECT 1;
