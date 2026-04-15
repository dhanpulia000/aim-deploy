-- 업무 가이드 데이터베이스 스키마
-- SQLite: 메타데이터 저장
-- PostgreSQL: 벡터 임베딩 저장

-- ============================================
-- SQLite 스키마 (메타데이터)
-- ============================================

-- 업무 가이드 메타데이터 테이블
CREATE TABLE IF NOT EXISTS WorkGuide (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  categoryGroupId INTEGER,
  categoryId INTEGER,
  guideType TEXT NOT NULL, -- 'classification', 'handling', 'escalation', 'general', 'faq'
  priority INTEGER DEFAULT 0, -- 높을수록 우선순위 높음
  tags TEXT, -- JSON array: ["계정도용", "긴급처리"]
  metadata TEXT, -- JSON: 추가 메타데이터
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoryGroupId) REFERENCES CategoryGroup(id),
  FOREIGN KEY (categoryId) REFERENCES Category(id)
);

-- 가이드 인덱스
CREATE INDEX IF NOT EXISTS idx_workguide_category ON WorkGuide(categoryGroupId, categoryId);
CREATE INDEX IF NOT EXISTS idx_workguide_type ON WorkGuide(guideType);
CREATE INDEX IF NOT EXISTS idx_workguide_priority ON WorkGuide(priority DESC);

-- ============================================
-- PostgreSQL 스키마 (벡터 임베딩)
-- ============================================

-- 가이드 벡터 임베딩 테이블
CREATE TABLE IF NOT EXISTS guide_embeddings (
  id TEXT PRIMARY KEY,
  guide_id TEXT NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small는 1536 차원
  chunk_index INTEGER DEFAULT 0, -- 긴 가이드를 청크로 나눌 경우 인덱스
  chunk_text TEXT, -- 원본 텍스트 청크
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(guide_id, chunk_index)
);

-- 벡터 검색 성능을 위한 인덱스
CREATE INDEX IF NOT EXISTS guide_embeddings_vector_idx 
ON guide_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- guide_id 인덱스
CREATE INDEX IF NOT EXISTS guide_embeddings_guide_id_idx 
ON guide_embeddings(guide_id);

-- chunk_index 인덱스
CREATE INDEX IF NOT EXISTS guide_embeddings_chunk_idx 
ON guide_embeddings(guide_id, chunk_index);
