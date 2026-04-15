/**
 * 업무 가이드 서비스
 * 가이드 CRUD 및 벡터 검색 기능 제공
 */

const { query, queryOne, execute } = require('../libs/db');
const { query: pgQuery, queryOne: pgQueryOne, execute: pgExecute } = require('../libs/db-postgres');
const embeddingService = require('./embedding.service');
const logger = require('../utils/logger');
const { nanoid } = require('nanoid');

class WorkGuideService {
  /**
   * 가이드 생성
   */
  async createGuide(data) {
    const {
      title,
      content,
      categoryGroupId = null,
      categoryId = null,
      guideType = 'general',
      priority = 0,
      tags = [],
      metadata = {}
    } = data;

    if (!title || !content) {
      throw new Error('제목과 내용은 필수입니다');
    }

    // 중복 체크: 제목과 내용이 동일한 가이드가 있는지 확인
    const normalizedTitle = title.trim().toLowerCase();
    const normalizedContent = content.trim().toLowerCase();
    const existing = query(
      'SELECT id, title FROM WorkGuide WHERE LOWER(TRIM(title)) = ? AND LOWER(TRIM(content)) = ?',
      [normalizedTitle, normalizedContent]
    );
    
    if (existing && existing.length > 0) {
      throw new Error(`동일한 제목과 내용의 가이드가 이미 존재합니다: "${existing[0].title}"`);
    }

    const id = nanoid();
    const now = new Date().toISOString();

    // SQLite에 메타데이터 저장
    execute(
      `INSERT INTO WorkGuide 
       (id, title, content, categoryGroupId, categoryId, guideType, priority, tags, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        content,
        categoryGroupId,
        categoryId,
        guideType,
        priority,
        JSON.stringify(tags),
        JSON.stringify(metadata),
        now,
        now
      ]
    );

    // 벡터 임베딩 생성 및 저장
    await this.generateAndStoreEmbedding(id, content);

    logger.info('[WorkGuide] Guide created', { id, title, guideType });

    return this.getGuide(id);
  }

  /**
   * 가이드 조회
   */
  getGuide(id) {
    const guide = queryOne('SELECT * FROM WorkGuide WHERE id = ?', [id]);
    if (!guide) {
      return null;
    }

    return {
      ...guide,
      tags: guide.tags ? JSON.parse(guide.tags) : [],
      metadata: guide.metadata ? JSON.parse(guide.metadata) : {}
    };
  }

  /**
   * 가이드 목록 조회
   */
  listGuides(filters = {}) {
    const { categoryGroupId, categoryId, guideType, search } = filters;
    
    let sql = 'SELECT * FROM WorkGuide WHERE 1=1';
    const params = [];

    if (categoryGroupId) {
      sql += ' AND categoryGroupId = ?';
      params.push(categoryGroupId);
    }

    if (categoryId) {
      sql += ' AND categoryId = ?';
      params.push(categoryId);
    }

    if (guideType) {
      sql += ' AND guideType = ?';
      params.push(guideType);
    }

    if (search) {
      sql += ' AND (title LIKE ? OR content LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    sql += ' ORDER BY priority DESC, createdAt DESC';

    const guides = query(sql, params);

    return guides.map(guide => ({
      ...guide,
      tags: guide.tags ? JSON.parse(guide.tags) : [],
      metadata: guide.metadata ? JSON.parse(guide.metadata) : {}
    }));
  }

  /**
   * 가이드 업데이트
   */
  async updateGuide(id, data) {
    const guide = this.getGuide(id);
    if (!guide) {
      throw new Error('가이드를 찾을 수 없습니다');
    }

    const {
      title,
      content,
      categoryGroupId,
      categoryId,
      guideType,
      priority,
      tags,
      metadata
    } = data;

    const updateFields = [];
    const params = [];

    if (title !== undefined) {
      updateFields.push('title = ?');
      params.push(title);
    }

    if (content !== undefined) {
      updateFields.push('content = ?');
      params.push(content);
      // 내용이 변경되면 임베딩 재생성 필요
    }

    if (categoryGroupId !== undefined) {
      updateFields.push('categoryGroupId = ?');
      params.push(categoryGroupId);
    }

    if (categoryId !== undefined) {
      updateFields.push('categoryId = ?');
      params.push(categoryId);
    }

    if (guideType !== undefined) {
      updateFields.push('guideType = ?');
      params.push(guideType);
    }

    if (priority !== undefined) {
      updateFields.push('priority = ?');
      params.push(priority);
    }

    if (tags !== undefined) {
      updateFields.push('tags = ?');
      params.push(JSON.stringify(tags));
    }

    if (metadata !== undefined) {
      updateFields.push('metadata = ?');
      params.push(JSON.stringify(metadata));
    }

    if (updateFields.length === 0) {
      return guide;
    }

    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(id);

    execute(
      `UPDATE WorkGuide SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    // 내용이 변경되었으면 임베딩 재생성
    if (content !== undefined) {
      await this.generateAndStoreEmbedding(id, content);
    }

    logger.info('[WorkGuide] Guide updated', { id });

    return this.getGuide(id);
  }

  /**
   * 가이드 삭제
   */
  async deleteGuide(id) {
    const guide = this.getGuide(id);
    if (!guide) {
      throw new Error('가이드를 찾을 수 없습니다');
    }

    // SQLite에서 삭제
    execute('DELETE FROM WorkGuide WHERE id = ?', [id]);

    // PostgreSQL에서 임베딩 삭제
    try {
      await pgExecute('DELETE FROM guide_embeddings WHERE guide_id = $1', [id]);
    } catch (error) {
      logger.warn('[WorkGuide] Failed to delete embeddings', { id, error: error.message });
    }

    logger.info('[WorkGuide] Guide deleted', { id });

    return true;
  }

  /**
   * 가이드 내용을 청크로 분할
   */
  splitIntoChunks(text, maxChunkSize = 2000) {
    const chunks = [];
    const sentences = text.split(/[.!?]\s+/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? '. ' : '') + sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * 가이드 임베딩 생성 및 저장
   */
  async generateAndStoreEmbedding(guideId, content) {
    try {
      // pgvector/guide_embeddings가 없는 환경에서도 WorkGuide CRUD는 계속 동작해야 합니다.
      // 임베딩 저장은 "가능한 경우에만" 수행합니다.
      try {
        await pgExecute('DELETE FROM guide_embeddings WHERE guide_id = $1', [guideId]);
      } catch (e) {
        logger.warn('[WorkGuide] guide_embeddings not available (skip embedding store)', {
          guideId,
          error: e?.message || String(e),
        });
        return false;
      }

      // 내용을 청크로 분할
      const chunks = this.splitIntoChunks(content);

      // 각 청크에 대해 임베딩 생성 및 저장
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await embeddingService.generateEmbedding(chunk);

        if (!embedding) {
          logger.warn('[WorkGuide] Failed to generate embedding for chunk', {
            guideId,
            chunkIndex: i
          });
          continue;
        }

        const embeddingId = nanoid();
        // PostgreSQL의 vector 타입은 배열 형식 문자열을 받습니다: '[1,2,3]'
        // pg 라이브러리가 배열을 JSON 객체로 변환하는 것을 방지하기 위해 문자열로 변환
        const embeddingString = '[' + embedding.join(',') + ']';
        try {
          await pgExecute(
            `INSERT INTO guide_embeddings (id, guide_id, embedding, chunk_index, chunk_text, created_at, updated_at)
             VALUES ($1, $2, $3::vector, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [embeddingId, guideId, embeddingString, i, chunk]
          );
        } catch (e) {
          logger.warn('[WorkGuide] Failed to store embedding chunk (skip remaining chunks)', {
            guideId,
            chunkIndex: i,
            error: e?.message || String(e),
          });
          return false;
        }
      }

      logger.info('[WorkGuide] Embeddings generated and stored', {
        guideId,
        chunksCount: chunks.length
      });

      return true;
    } catch (error) {
      const msg = error?.message || String(error);
      if (/type\s+\"?vector\"?\s+does\s+not\s+exist/i.test(msg) || /relation\s+\"?guide_embeddings\"?\s+does\s+not\s+exist/i.test(msg)) {
        logger.warn('[WorkGuide] Embedding skipped (pgvector not available)', { guideId, error: msg });
        return false;
      }
      logger.error('[WorkGuide] Failed to generate and store embedding', { guideId, error: msg, stack: error.stack });
      return false;
    }
  }

  /**
   * 유사한 가이드 검색 (벡터 검색)
   */
  /**
   * metadata.language 가 'ko' | 'en' 인 가이드만 허용 (RAG 언어 정합)
   * - language 'ko': 한국어 매뉴얼 + language 미지정(레거시 가이드)
   * - language 'en': 영어 매뉴얼만
   * - language null/기타: 필터 없음
   */
  _guideIdsForLanguageFilter(language) {
    if (!language) return null;
    const all = query('SELECT id, metadata FROM WorkGuide', []);
    const ids = [];
    for (const row of all) {
      let meta = {};
      try {
        meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata || '{}') : row.metadata || {};
      } catch {
        meta = {};
      }
      const gl = meta.language;
      if (language === 'en') {
        if (gl === 'en') ids.push(row.id);
      } else if (language === 'ko') {
        if (gl === 'ko' || gl == null || gl === undefined) ids.push(row.id);
      }
    }
    return ids;
  }

  async searchSimilarGuides(queryText, options = {}) {
    const {
      limit = 5,
      threshold = 0.7,
      categoryGroupId = null,
      categoryId = null,
      guideType = null,
      language = null
    } = options;

    try {
      // 쿼리 텍스트를 벡터 임베딩으로 변환
      const queryEmbedding = await embeddingService.generateEmbedding(queryText);
      if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
        throw new Error('임베딩 생성 실패');
      }

      // PostgreSQL의 vector 타입은 배열 형식 문자열을 받습니다: '[1,2,3]'
      // pg 라이브러리가 배열을 JSON 객체로 변환하는 것을 방지하기 위해 문자열로 변환
      const embeddingString = '[' + queryEmbedding.join(',') + ']';

      // 벡터 유사도 검색
      let sql = `
        SELECT 
          ge.guide_id,
          ge.chunk_index,
          ge.chunk_text,
          1 - (ge.embedding <=> $1::vector) as similarity
        FROM guide_embeddings ge
        WHERE 1 - (ge.embedding <=> $1::vector) >= $2
      `;

      const params = [embeddingString, threshold];

      // SQLite에서 필터링할 가이드 ID 조회
      let filterSql = 'SELECT id FROM WorkGuide WHERE 1=1';
      const filterParams = [];

      if (categoryGroupId) {
        filterSql += ' AND categoryGroupId = ?';
        filterParams.push(categoryGroupId);
      }

      if (categoryId) {
        filterSql += ' AND categoryId = ?';
        filterParams.push(categoryId);
      }

      if (guideType) {
        filterSql += ' AND guideType = ?';
        filterParams.push(guideType);
      }

      const langAllowedIds = this._guideIdsForLanguageFilter(language);
      if (language && (!langAllowedIds || langAllowedIds.length === 0)) {
        logger.debug('[WorkGuide] No guides match language filter', { language });
        return [];
      }

      const filteredGuides = query(filterSql, filterParams);
      let guideIds = filteredGuides.map(g => g.id);

      if (langAllowedIds) {
        const allow = new Set(langAllowedIds);
        guideIds = guideIds.filter((id) => allow.has(id));
      }

      if (language && guideIds.length === 0) {
        return [];
      }

      if (guideIds.length > 0) {
        const placeholders = guideIds.map((_, i) => `$${params.length + 1 + i}`).join(',');
        sql += ` AND ge.guide_id IN (${placeholders})`;
        params.push(...guideIds);
      }

      sql += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const results = await pgQuery(sql, params);

      // SQLite에서 가이드 메타데이터 조회
      const guideIdsFromResults = [...new Set(results.map(r => r.guide_id))];
      const guides = guideIdsFromResults.length > 0
        ? query(
            `SELECT * FROM WorkGuide WHERE id IN (${guideIdsFromResults.map(() => '?').join(',')})`,
            guideIdsFromResults
          )
        : [];

      const guidesMap = {};
      guides.forEach(g => {
        guidesMap[g.id] = {
          ...g,
          tags: g.tags ? JSON.parse(g.tags) : [],
          metadata: g.metadata ? JSON.parse(g.metadata) : {}
        };
      });

      // 결과 조합
      return results.map(result => ({
        guide: guidesMap[result.guide_id] || null,
        chunkIndex: result.chunk_index,
        chunkText: result.chunk_text,
        similarity: parseFloat(result.similarity)
      })).filter(r => r.guide !== null);
    } catch (error) {
      const msg = error?.message || String(error);
      if (/type\s+\"?vector\"?\s+does\s+not\s+exist/i.test(msg) || /relation\s+\"?guide_embeddings\"?\s+does\s+not\s+exist/i.test(msg)) {
        logger.warn('[WorkGuide] Vector search unavailable (pgvector not available)', { error: msg });
        return [];
      }
      logger.error('[WorkGuide] Search failed', { error: msg, stack: error.stack });
      throw error;
    }
  }
}

// 싱글톤 인스턴스
let instance = null;

function getWorkGuideService() {
  if (!instance) {
    instance = new WorkGuideService();
  }
  return instance;
}

module.exports = {
  WorkGuideService,
  getWorkGuideService
};
