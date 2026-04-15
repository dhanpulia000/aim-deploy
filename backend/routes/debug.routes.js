/**
 * 디버그용 API 엔드포인트 (Admin 전용)
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middlewares/auth.middleware');
const { classifyIssueCategory } = require('../services/issueClassifier');
const { prisma } = require('../libs/db');
const logger = require('../utils/logger');

/**
 * AI 분류 테스트 엔드포인트
 * POST /api/debug/ai-classify
 * Body: { text: "분류할 텍스트..." }
 */
router.post('/ai-classify', authenticate, requireAdmin(), async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'text is required (string)' });
    }

    logger.info('[Debug] AI classify request', { textLength: text.length });

    const result = await classifyIssueCategory({
      text,
      prisma
    });

    // 카테고리 정보도 함께 반환
    let categoryGroup = null;
    let category = null;

    if (result.groupId) {
      categoryGroup = await prisma.categoryGroup.findUnique({
        where: { id: result.groupId },
        include: {
          categories: {
            where: { isActive: true }
          }
        }
      });
    }

    if (result.categoryId) {
      category = await prisma.category.findUnique({
        where: { id: result.categoryId },
        include: { group: true }
      });
    }

    res.json({
      classification: result,
      categoryGroup: categoryGroup
        ? {
            id: categoryGroup.id,
            name: categoryGroup.name,
            code: categoryGroup.code,
            importance: categoryGroup.importance
          }
        : null,
      category: category
        ? {
            id: category.id,
            name: category.name,
            code: category.code
          }
        : null
    });
  } catch (error) {
    logger.error('[Debug] AI classify error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      error: 'Internal error',
      message: error.message
    });
  }
});

module.exports = router;























