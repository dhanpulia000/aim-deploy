-- RawLog 테이블에 boardId, articleId 컬럼 추가 및 유니크 인덱스 생성
-- 보조 크롤러의 중복 방지를 위한 마이그레이션

-- 1. boardId 컬럼 추가 (NULL 허용, 기존 데이터는 metadata에서 추출)
ALTER TABLE RawLog ADD COLUMN boardId INTEGER;

-- 2. articleId 컬럼 추가 (NULL 허용, 기존 데이터는 metadata에서 추출)
ALTER TABLE RawLog ADD COLUMN articleId TEXT;

-- 3. 기존 데이터의 metadata에서 boardId, articleId 추출하여 업데이트
UPDATE RawLog 
SET 
  boardId = CAST(
    json_extract(metadata, '$.monitoredBoardId') AS INTEGER
  ),
  articleId = json_extract(metadata, '$.externalPostId')
WHERE 
  source = 'naver' 
  AND metadata IS NOT NULL
  AND metadata != '{}'
  AND (
    json_extract(metadata, '$.monitoredBoardId') IS NOT NULL
    OR json_extract(metadata, '$.externalPostId') IS NOT NULL
  );

-- 4. 유니크 인덱스 생성 (boardId, articleId 조합)
-- SQLite는 NULL 값은 유니크 제약에서 제외되므로, boardId와 articleId가 모두 NULL이 아닌 경우에만 유니크 체크
CREATE UNIQUE INDEX IF NOT EXISTS idx_rawlog_board_article 
ON RawLog(boardId, articleId);

-- 5. 인덱스 추가 (조회 성능 향상)
CREATE INDEX IF NOT EXISTS idx_rawlog_boardId ON RawLog(boardId);
CREATE INDEX IF NOT EXISTS idx_rawlog_articleId ON RawLog(articleId);

