/**
 * 벡터 검색 서비스 (하이브리드 방식)
 * PostgreSQL + pgvector를 사용하여 벡터 검색만 처리
 * 기존 SQLite는 메타데이터 저장용으로 유지
 */

const logger = require('../utils/logger');
const { query, queryOne, execute } = require('../libs/db-postgres');
const sqliteDb = require('../libs/db');

class VectorSearchService {
  constructor() {
    this.isAvailable = false;
    this.initialized = false;
    // init()은 외부에서 명시적으로 호출 (비동기)
  }

  /**
   * 서비스 초기화 (pgvector 확장 확인)
   */
  async init() {
    if (this.initialized) {
      return; // 이미 초기화됨
    }
    try {
      // PostgreSQL 연결 확인
      const pool = require('../libs/db-postgres').getPool();
      if (!pool) {
        logger.warn('[VectorSearch] PostgreSQL connection pool not available');
        this.isAvailable = false;
        return;
      }

      // pgvector 확장 확인
      const result = await query(
        "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') as exists"
      );

      if (!result[0]?.exists) {
        logger.warn('[VectorSearch] pgvector extension not installed. Vector search will be disabled.');
        logger.info('[VectorSearch] To enable: CREATE EXTENSION vector;');
        this.isAvailable = false;
        return;
      }

      // 테이블 생성 (없으면)
      await this.createTables();

      this.isAvailable = true;
      this.initialized = true;
      logger.info('[VectorSearch] Service initialized successfully');
    } catch (error) {
      logger.error('[VectorSearch] Initialization failed', {
        error: error.message,
        stack: error.stack
      });
      this.isAvailable = false;
      this.initialized = true; // 실패해도 초기화 시도 완료로 표시
    }
  }

  /**
   * 벡터 임베딩 저장 테이블 생성
   */
  async createTables() {
    try {
      // Issue 임베딩 테이블
      await execute(`
        CREATE TABLE IF NOT EXISTS issue_embeddings (
          id TEXT PRIMARY KEY,
          issue_id TEXT NOT NULL,
          embedding vector(1536), -- OpenAI text-embedding-3-small는 1536 차원
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(issue_id)
        )
      `);

      // 벡터 검색 성능을 위한 인덱스 생성
      await execute(`
        CREATE INDEX IF NOT EXISTS issue_embeddings_vector_idx 
        ON issue_embeddings 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      // issue_id 인덱스 (이슈 조회 성능 향상)
      await execute(`
        CREATE INDEX IF NOT EXISTS issue_embeddings_issue_id_idx 
        ON issue_embeddings(issue_id)
      `);

      logger.info('[VectorSearch] Tables and indexes created');
    } catch (error) {
      // 테이블이 이미 존재하거나 다른 오류
      if (error.message.includes('already exists')) {
        logger.debug('[VectorSearch] Tables already exist');
      } else {
        logger.error('[VectorSearch] Failed to create tables', {
          error: error.message
        });
        throw error;
      }
    }
  }

  /**
   * 이슈에 대한 벡터 임베딩 저장
   * @param {string} issueId - 이슈 ID
   * @param {Array<number>} embedding - 벡터 임베딩 (1536 차원)
   * @returns {Promise<boolean>} 저장 성공 여부
   */
  async storeEmbedding(issueId, embedding) {
    if (!this.isAvailable) {
      logger.warn('[VectorSearch] Service not available, skipping embedding storage');
      return false;
    }

    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      logger.error('[VectorSearch] Invalid embedding format', {
        issueId,
        embeddingLength: embedding?.length
      });
      return false;
    }

    try {
      const { nanoid } = require('nanoid');
      const id = nanoid();

      // PostgreSQL의 vector 타입은 배열을 직접 받습니다
      // pg 라이브러리가 자동으로 변환하지만, 배열 형태로 전달
      await execute(
        `INSERT INTO issue_embeddings (id, issue_id, embedding, updated_at)
         VALUES ($1, $2, $3::vector, CURRENT_TIMESTAMP)
         ON CONFLICT (issue_id) 
         DO UPDATE SET embedding = $3::vector, updated_at = CURRENT_TIMESTAMP`,
        [id, issueId, embedding]
      );

      logger.debug('[VectorSearch] Embedding stored', {
        issueId,
        embeddingLength: embedding.length
      });

      return true;
    } catch (error) {
      logger.error('[VectorSearch] Failed to store embedding', {
        issueId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * 유사한 이슈 검색 (벡터 유사도 기반)
   * @param {Array<number>} queryEmbedding - 검색 쿼리 벡터 임베딩
   * @param {number} limit - 반환할 결과 수 (기본값: 10)
   * @param {number} threshold - 유사도 임계값 (0~1, 기본값: 0.7)
   * @returns {Promise<Array>} 유사한 이슈 목록 (SQLite에서 조회)
   */
  async searchSimilar(queryEmbedding, limit = 10, threshold = 0.7) {
    if (!this.isAvailable) {
      logger.warn('[VectorSearch] Service not available, returning empty results');
      return [];
    }

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== 1536) {
      logger.error('[VectorSearch] Invalid query embedding format', {
        embeddingLength: queryEmbedding?.length
      });
      return [];
    }

    try {
      // pgvector를 사용한 코사인 유사도 검색
      // 1 - (embedding <=> queryEmbedding) 는 코사인 유사도 (1에 가까울수록 유사)
      // PostgreSQL의 vector 타입은 배열을 직접 받습니다
      const results = await query(
        `SELECT 
          issue_id,
          1 - (embedding <=> $1::vector) as similarity
         FROM issue_embeddings
         WHERE 1 - (embedding <=> $1::vector) >= $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [queryEmbedding, threshold, limit]
      );

      if (results.length === 0) {
        logger.debug('[VectorSearch] No similar issues found', {
          threshold,
          limit
        });
        return [];
      }

      // SQLite에서 실제 이슈 데이터 조회 (동기 함수)
      const issueIds = results.map(r => r.issue_id);
      const issues = this.getIssuesFromSqlite(issueIds);

      // 유사도 점수 추가
      const similarityMap = new Map(
        results.map(r => [r.issue_id, parseFloat(r.similarity)])
      );

      const issuesWithSimilarity = issues.map(issue => ({
        ...issue,
        similarity: similarityMap.get(issue.id) || 0
      }));

      // 유사도 순으로 정렬
      issuesWithSimilarity.sort((a, b) => b.similarity - a.similarity);

      logger.debug('[VectorSearch] Similar issues found', {
        queryEmbeddingLength: queryEmbedding.length,
        found: issuesWithSimilarity.length,
        threshold
      });

      return issuesWithSimilarity;
    } catch (error) {
      logger.error('[VectorSearch] Failed to search similar issues', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * SQLite에서 이슈 데이터 조회
   * @param {Array<string>} issueIds - 이슈 ID 목록
   * @returns {Array} 이슈 목록 (동기 함수)
   */
  getIssuesFromSqlite(issueIds) {
    if (!issueIds || issueIds.length === 0) {
      return [];
    }

    try {
      const placeholders = issueIds.map(() => '?').join(',');
      const issues = sqliteDb.query(
        `SELECT * FROM ReportItemIssue WHERE id IN (${placeholders})`,
        issueIds
      );

      return issues;
    } catch (error) {
      logger.error('[VectorSearch] Failed to get issues from SQLite', {
        error: error.message,
        issueIdsCount: issueIds.length
      });
      return [];
    }
  }

  /**
   * 이슈의 벡터 임베딩 삭제
   * @param {string} issueId - 이슈 ID
   * @returns {Promise<boolean>} 삭제 성공 여부
   */
  async deleteEmbedding(issueId) {
    if (!this.isAvailable) {
      return false;
    }

    try {
      await execute(
        'DELETE FROM issue_embeddings WHERE issue_id = $1',
        [issueId]
      );

      logger.debug('[VectorSearch] Embedding deleted', { issueId });
      return true;
    } catch (error) {
      logger.error('[VectorSearch] Failed to delete embedding', {
        issueId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * 서비스 사용 가능 여부 확인
   * @returns {boolean} 사용 가능 여부
   */
  isServiceAvailable() {
    return this.isAvailable;
  }
}

// 싱글톤 인스턴스
let instance = null;

function getVectorSearchService() {
  if (!instance) {
    instance = new VectorSearchService();
  }
  return instance;
}

module.exports = {
  VectorSearchService,
  getVectorSearchService
};
