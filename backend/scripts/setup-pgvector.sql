-- PostgreSQL + pgvector 설정 스크립트
-- 실행 방법: psql -U postgres -d your_database -f setup-pgvector.sql

-- 1. pgvector 확장 설치
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Issue 임베딩 테이블 생성
CREATE TABLE IF NOT EXISTS issue_embeddings (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small는 1536 차원
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(issue_id)
);

-- 3. 인덱스 생성 (벡터 검색 성능 향상)
CREATE INDEX IF NOT EXISTS issue_embeddings_vector_idx 
ON issue_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- 4. issue_id 인덱스 (SQLite 조인 성능 향상)
CREATE INDEX IF NOT EXISTS issue_embeddings_issue_id_idx 
ON issue_embeddings(issue_id);

-- 5. 확인
SELECT 
  extname as extension_name,
  extversion as version
FROM pg_extension 
WHERE extname = 'vector';

SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'issue_embeddings';
