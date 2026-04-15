/**
 * 벡터 검색 API 컨트롤러
 */

const logger = require('../utils/logger');
const vectorSearchService = require('../services/vectorSearch.service').getVectorSearchService();
const embeddingService = require('../services/embedding.service');
const { query } = require('../libs/db'); // SQLite에서 이슈 조회용

/**
 * 벡터 검색 API
 * POST /api/vector-search
 * Body: { text: string, limit?: number, threshold?: number }
 */
async function searchSimilarIssues(req, res) {
  try {
    const { text, limit = 10, threshold = 0.7 } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    // 서비스 사용 가능 여부 확인
    if (!vectorSearchService.isServiceAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Vector search service is not available. Please configure PostgreSQL + pgvector.'
      });
    }

    // 텍스트를 벡터 임베딩으로 변환
    const queryEmbedding = await embeddingService.generateEmbedding(text);
    if (!queryEmbedding) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate embedding'
      });
    }

    // 유사한 이슈 검색
    const similarIssues = await vectorSearchService.searchSimilar(
      queryEmbedding,
      limit,
      threshold
    );

    logger.info('[VectorSearch] Similar issues found', {
      queryTextLength: text.length,
      found: similarIssues.length,
      limit,
      threshold
    });

    return res.json({
      success: true,
      data: {
        query: text,
        results: similarIssues,
        count: similarIssues.length
      }
    });
  } catch (error) {
    logger.error('[VectorSearch] Search failed', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * 이슈에 대한 벡터 임베딩 생성 및 저장
 * POST /api/vector-search/embed
 * Body: { issueId: string }
 */
async function createEmbedding(req, res) {
  try {
    const { issueId } = req.body;

    if (!issueId) {
      return res.status(400).json({
        success: false,
        error: 'issueId is required'
      });
    }

    // 서비스 사용 가능 여부 확인
    if (!vectorSearchService.isServiceAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Vector search service is not available'
      });
    }

    // SQLite에서 이슈 조회
    const issues = query(
      'SELECT id, summary, detail, source FROM ReportItemIssue WHERE id = ?',
      [issueId]
    );

    if (issues.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Issue not found'
      });
    }

    const issue = issues[0];

    // 벡터 임베딩 생성
    const embedding = await embeddingService.generateIssueEmbedding(issue);
    if (!embedding) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate embedding'
      });
    }

    // 벡터 임베딩 저장
    const success = await vectorSearchService.storeEmbedding(issueId, embedding);
    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to store embedding'
      });
    }

    logger.info('[VectorSearch] Embedding created', {
      issueId,
      embeddingLength: embedding.length
    });

    return res.json({
      success: true,
      data: {
        issueId,
        embeddingLength: embedding.length
      }
    });
  } catch (error) {
    logger.error('[VectorSearch] Embedding creation failed', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

/**
 * 벡터 검색 서비스 상태 확인
 * GET /api/vector-search/status
 */
async function getStatus(req, res) {
  try {
    const isAvailable = vectorSearchService.isServiceAvailable();

    return res.json({
      success: true,
      data: {
        available: isAvailable,
        type: 'postgresql + pgvector'
      }
    });
  } catch (error) {
    logger.error('[VectorSearch] Status check failed', {
      error: error.message
    });

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

module.exports = {
  searchSimilarIssues,
  createEmbedding,
  getStatus
};
