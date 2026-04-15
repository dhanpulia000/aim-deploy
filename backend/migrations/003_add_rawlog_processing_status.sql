-- RawLog 테이블에 처리 상태 관리 컬럼 추가
-- SQLite에서 중복 처리/무한 반복 방지를 위한 락 메커니즘 지원

-- 1. processingStatus 컬럼 추가 (NEW, PROCESSING, DONE, ERROR)
ALTER TABLE RawLog ADD COLUMN processingStatus TEXT NOT NULL DEFAULT 'NEW';

-- 2. attempts 컬럼 추가 (재시도 횟수)
ALTER TABLE RawLog ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

-- 3. lastError 컬럼 추가 (마지막 오류 메시지)
ALTER TABLE RawLog ADD COLUMN lastError TEXT NULL;

-- 4. lockedAt 컬럼 추가 (락 선점 시간)
ALTER TABLE RawLog ADD COLUMN lockedAt TEXT NULL;

-- 5. nextRetryAt 컬럼 추가 (다음 재시도 시간)
ALTER TABLE RawLog ADD COLUMN nextRetryAt TEXT NULL;

-- 6. 기존 데이터 초기화
-- isProcessed=0인 데이터는 NEW, isProcessed=1인 데이터는 DONE으로 설정
UPDATE RawLog 
SET processingStatus = CASE 
  WHEN isProcessed = 0 THEN 'NEW'
  WHEN isProcessed = 1 THEN 'DONE'
  ELSE 'NEW'
END
WHERE processingStatus = 'NEW';

-- 7. 인덱스 생성 (조회 성능 향상)
-- 처리 대기 중인 RawLog 조회 최적화
CREATE INDEX IF NOT EXISTS idx_rawlog_status_retry 
ON RawLog(processingStatus, nextRetryAt);

-- 락이 만료된 RawLog 조회 최적화
CREATE INDEX IF NOT EXISTS idx_rawlog_status_locked 
ON RawLog(processingStatus, lockedAt);

-- 처리 상태별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_rawlog_status_processed 
ON RawLog(processingStatus, isProcessed);





