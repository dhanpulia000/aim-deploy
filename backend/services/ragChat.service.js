/**
 * RAG 기반 챗봇 서비스
 * Retrieval-Augmented Generation을 사용하여 컨텍스트 기반 답변 생성
 */

const axios = require('axios');
const logger = require('../utils/logger');
const workGuideService = require('./workGuide.service').getWorkGuideService();
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

class RAGChatService {
  /**
   * OpenAI API 설정
   */
  getAIConfig() {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-3.5-turbo',
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000
    };
  }

  /**
   * 컨텍스트 기반 답변 생성
   */
  async generateAnswer(question, context = {}) {
    try {
      const { apiKey, baseUrl, chatModel, maxTokens } = this.getAIConfig();

      if (!apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      const uiLang = context.language === 'en' || context.language === 'ko' ? context.language : null;

      // 1. 유사한 가이드 검색 (RAG 데이터 검색)
      // threshold를 낮춰서 더 많은 관련 가이드를 찾을 수 있도록 함
      const searchOptions = {
        limit: 10, // 더 많은 결과 가져오기
        threshold: 0.3, // 관련도 임계값을 매우 낮춰서 관련 가이드 검색 (짧은 가이드도 포함)
        categoryGroupId: context.categoryGroupId || null,
        categoryId: context.categoryId || null,
        guideType: null,
        language: uiLang
      };

      logger.debug('[RAGChat] Searching similar guides', {
        question: question.substring(0, 100),
        searchOptions
      });

      const similarGuides = await workGuideService.searchSimilarGuides(question, searchOptions);
      
      logger.info('[RAGChat] Similar guides found', {
        count: similarGuides.length,
        guides: similarGuides.map(g => ({
          id: g.guide.id,
          title: g.guide.title,
          similarity: g.similarity
        }))
      });

      // 2. 컨텍스트 구성 — UI 언어에 맞춤 (한국어/영어)
      const systemPrompt =
        uiLang === 'en'
          ? `You are an AI assistant for game operations agents using an issue wallboard.
Answer using ONLY the provided work-guide excerpts. Do not invent policy or UI steps that are not in the guides.
If the guides do not cover the question, say clearly that no guide content was found.

Style: clear, concise, step-by-step where helpful; quote guide meaning faithfully.`
          : `당신은 고객 지원 에이전트를 도와주는 AI 어시스턴트입니다.
에이전트가 이슈를 처리할 때 도움을 주는 업무 가이드를 제공합니다.

**중요 규칙:**
- 반드시 주어진 업무 가이드 데이터만 참고하여 답변하세요
- 가이드에 없는 내용은 일반적인 지식으로 추측하거나 답변하지 마세요
- 가이드에 없는 내용에 대해서는 "해당 내용에 대한 가이드가 없습니다"라고 명확히 안내하세요
- 주어진 가이드를 정확히 기반으로 답변하세요

답변 형식:
- 명확하고 간결하게
- 단계별로 설명
- 구체적인 예시 포함
- 참고한 가이드의 내용을 그대로 인용하되, 자연스럽게 재구성`;

      let userPrompt = uiLang === 'en' ? `Question: ${question}\n\n` : `질문: ${question}\n\n`;

      if (similarGuides.length > 0) {
        if (uiLang === 'en') {
          userPrompt += `Below are relevant work-guide excerpts. Answer using ONLY this material:\n\n`;
          similarGuides.forEach((result, index) => {
            userPrompt += `[Guide ${index + 1}] ${result.guide.title}\n`;
            userPrompt += `${result.chunkText}\n\n`;
          });
          userPrompt += `Answer the question from these excerpts only. If something is not covered, say so.`;
        } else {
          userPrompt += `다음은 질문과 관련된 업무 가이드입니다. 이 가이드만을 참고하여 답변해주세요:\n\n`;
          similarGuides.forEach((result, index) => {
            userPrompt += `[가이드 ${index + 1}] ${result.guide.title}\n`;
            userPrompt += `${result.chunkText}\n\n`;
          });
          userPrompt += `위 가이드 내용만을 기반으로 질문에 답변해주세요. 가이드에 없는 내용은 추측하지 마세요.`;
        }
      } else {
        return {
          answer:
            uiLang === 'en'
              ? `No relevant work guide was found for your question.\n\nTry:\n1. Rephrasing with different keywords\n2. Asking an admin to add or import guide content (e.g. English user manual for RAG)`
              : `죄송합니다. 질문과 관련된 업무 가이드를 찾을 수 없습니다.\n\n다음 방법을 시도해보세요:\n1. 다른 키워드로 질문해보세요\n2. 가이드 관리자에게 해당 내용의 가이드 추가를 요청하세요`,
          sources: []
        };
      }

      // 3. OpenAI API 호출
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: chatModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const answer = response.data.choices[0]?.message?.content || '답변을 생성할 수 없습니다.';

      logger.info('[RAGChat] Answer generated', {
        questionLength: question.length,
        guidesUsed: similarGuides.length,
        answerLength: answer.length
      });

      return {
        answer,
        sources: similarGuides.map(result => ({
          guideId: result.guide.id,
          title: result.guide.title,
          relevance: result.similarity,
          excerpt: result.chunkText.substring(0, 200) + '...'
        }))
      };
    } catch (error) {
      logger.error('[RAGChat] Failed to generate answer', {
        error: error.message,
        stack: error.stack,
        question: question.substring(0, 100)
      });
      throw error;
    }
  }

  /**
   * 대화 히스토리 관리 (향후 확장용)
   */
  async generateAnswerWithHistory(question, history = [], context = {}) {
    // 현재는 단순 구현, 향후 대화 히스토리 활용 가능
    return this.generateAnswer(question, context);
  }
}

// 싱글톤 인스턴스
let instance = null;

function getRAGChatService() {
  if (!instance) {
    instance = new RAGChatService();
  }
  return instance;
}

module.exports = {
  RAGChatService,
  getRAGChatService
};
