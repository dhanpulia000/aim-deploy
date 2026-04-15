/**
 * 벡터 임베딩 생성 서비스
 * OpenAI Embedding API를 사용하여 텍스트를 벡터로 변환
 */

const axios = require('axios');
const logger = require('../utils/logger');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// 환경 변수
function getAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS) || 1536
  };
}

/**
 * 텍스트를 벡터 임베딩으로 변환
 * @param {string} text - 임베딩할 텍스트
 * @param {string} model - 사용할 모델 (기본값: text-embedding-3-small)
 * @returns {Promise<Array<number>>} 벡터 임베딩 (1536 차원)
 */
async function generateEmbedding(text, model = null) {
  const { apiKey, baseUrl, embeddingModel, embeddingDimensions } = getAIConfig();

  if (!apiKey) {
    logger.warn('[Embedding] OpenAI API key not configured');
    return null;
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    logger.warn('[Embedding] Empty or invalid text provided');
    return null;
  }

  const modelToUse = model || embeddingModel;

  try {
    // 텍스트가 너무 길면 잘라냄 (최대 8000 토큰, 약 6000자)
    const maxLength = 6000;
    const truncatedText = text.length > maxLength 
      ? text.substring(0, maxLength) 
      : text;

    const response = await axios.post(
      `${baseUrl}/embeddings`,
      {
        model: modelToUse,
        input: truncatedText,
        dimensions: embeddingDimensions
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30초 타임아웃
      }
    );

    const embedding = response.data.data[0].embedding;

    if (!Array.isArray(embedding) || embedding.length !== embeddingDimensions) {
      logger.error('[Embedding] Invalid embedding format', {
        length: embedding?.length,
        expected: embeddingDimensions
      });
      return null;
    }

    logger.debug('[Embedding] Embedding generated', {
      textLength: truncatedText.length,
      embeddingLength: embedding.length,
      model: modelToUse
    });

    return embedding;
  } catch (error) {
    logger.error('[Embedding] Failed to generate embedding', {
      error: error.message,
      response: error.response?.data,
      model: modelToUse
    });
    return null;
  }
}

/**
 * 여러 텍스트를 배치로 벡터 임베딩으로 변환
 * @param {Array<string>} texts - 임베딩할 텍스트 배열
 * @param {string} model - 사용할 모델
 * @returns {Promise<Array<Array<number>>>} 벡터 임베딩 배열
 */
async function generateEmbeddingsBatch(texts, model = null) {
  const { apiKey, baseUrl, embeddingModel, embeddingDimensions } = getAIConfig();

  if (!apiKey) {
    logger.warn('[Embedding] OpenAI API key not configured');
    return [];
  }

  if (!Array.isArray(texts) || texts.length === 0) {
    logger.warn('[Embedding] Empty or invalid texts array provided');
    return [];
  }

  const modelToUse = model || embeddingModel;

  try {
    // 텍스트 전처리 (길이 제한)
    const maxLength = 6000;
    const processedTexts = texts.map(text => {
      if (!text || typeof text !== 'string') return '';
      return text.length > maxLength ? text.substring(0, maxLength) : text;
    }).filter(text => text.length > 0);

    if (processedTexts.length === 0) {
      return [];
    }

    const response = await axios.post(
      `${baseUrl}/embeddings`,
      {
        model: modelToUse,
        input: processedTexts,
        dimensions: embeddingDimensions
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000 // 60초 타임아웃 (배치)
      }
    );

    const embeddings = response.data.data.map(item => item.embedding);

    // 유효성 검증
    const validEmbeddings = embeddings.filter(
      emb => Array.isArray(emb) && emb.length === embeddingDimensions
    );

    if (validEmbeddings.length !== embeddings.length) {
      logger.warn('[Embedding] Some embeddings are invalid', {
        total: embeddings.length,
        valid: validEmbeddings.length
      });
    }

    logger.debug('[Embedding] Batch embeddings generated', {
      inputCount: processedTexts.length,
      outputCount: validEmbeddings.length,
      model: modelToUse
    });

    return validEmbeddings;
  } catch (error) {
    logger.error('[Embedding] Failed to generate batch embeddings', {
      error: error.message,
      response: error.response?.data,
      model: modelToUse,
      textCount: texts.length
    });
    return [];
  }
}

/**
 * 이슈 텍스트를 벡터 임베딩으로 변환
 * @param {Object} issue - 이슈 객체 (summary, detail, source 포함)
 * @returns {Promise<Array<number>>} 벡터 임베딩
 */
async function generateIssueEmbedding(issue) {
  if (!issue) {
    logger.warn('[Embedding] Invalid issue provided');
    return null;
  }

  // 이슈의 텍스트 내용을 조합
  const textParts = [
    issue.summary || '',
    issue.detail || '',
    issue.source || ''
  ].filter(part => part && part.trim().length > 0);

  if (textParts.length === 0) {
    logger.warn('[Embedding] Issue has no text content', {
      issueId: issue.id
    });
    return null;
  }

  // 텍스트를 하나로 합침
  const combinedText = textParts.join('\n\n');

  return generateEmbedding(combinedText);
}

module.exports = {
  generateEmbedding,
  generateEmbeddingsBatch,
  generateIssueEmbedding,
  getAIConfig
};
