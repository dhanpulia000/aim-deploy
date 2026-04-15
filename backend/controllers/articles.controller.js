// Articles 컨트롤러

const articlesService = require('../services/articles.service');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');
const path = require('path');

/**
 * 커뮤니티 스크래핑 데이터 파일 목록 조회
 */
const getArticleFiles = asyncMiddleware(async (req, res) => {
  try {
    const files = await articlesService.getAvailableArticleFiles();
    sendSuccess(res, files, 'Article files retrieved successfully');
  } catch (error) {
    logger.error('Failed to get article files', { error: error.message });
    sendError(res, 'Failed to get article files', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

/**
 * 커뮤니티 스크래핑 데이터를 이슈로 변환하여 저장
 */
const importArticles = asyncMiddleware(async (req, res) => {
  const { fileName, agentId, projectId } = req.body;
  
  if (!fileName) {
    return sendValidationError(res, [{ field: 'fileName', message: 'File name is required' }]);
  }
  
  const filePath = path.join(__dirname, '..', '..', 'data', fileName);
  
  try {
    const result = await articlesService.importArticlesAsIssues(filePath, agentId || 'system', projectId);
    sendSuccess(res, result, 'Articles imported successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to import articles', { error: error.message, fileName });
    sendError(res, 'Failed to import articles', HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
  }
});

module.exports = {
  getArticleFiles,
  importArticles
};







