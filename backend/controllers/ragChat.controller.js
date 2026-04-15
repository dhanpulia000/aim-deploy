/**
 * RAG 챗봇 API 컨트롤러
 */

const logger = require('../utils/logger');
const ragChatService = require('../services/ragChat.service').getRAGChatService();
const { sendSuccess, sendError, HTTP_STATUS } = require('../utils/http');

/**
 * 챗봇 질문 및 답변
 * POST /api/chat/ask
 */
async function askQuestion(req, res) {
  try {
    const { question, context = {}, history = [] } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return sendError(res, '질문은 필수입니다', HTTP_STATUS.BAD_REQUEST);
    }

    const lang = context.language;
    const chatContext = {
      categoryGroupId: context.categoryGroupId || null,
      categoryId: context.categoryId || null,
      issueId: context.issueId || null,
      language: lang === 'en' || lang === 'ko' ? lang : null
    };

    // 답변 생성
    const result = await ragChatService.generateAnswerWithHistory(
      question,
      history,
      chatContext
    );

    logger.info('[RAGChat] Question answered', {
      questionLength: question.length,
      sourcesCount: result.sources.length
    });

    return sendSuccess(res, {
      question,
      answer: result.answer,
      sources: result.sources,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('[RAGChat] Failed to answer question', {
      error: error.message,
      stack: error.stack
    });

    return sendError(res, `답변 생성 실패: ${error.message}`, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  askQuestion
};
