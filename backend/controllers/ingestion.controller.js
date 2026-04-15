/**
 * 수동 수집 컨트롤러
 */

const { ingestByUrl } = require('../services/manualIngest.service');
const logger = require('../utils/logger');
const { sendError, sendSuccess, HTTP_STATUS } = require('../utils/http');

/**
 * POST /api/ingestion/manual
 * URL을 통해 네이버 카페 게시글을 수동으로 수집합니다.
 * 
 * @route POST /api/ingestion/manual
 * @body {string} url - 네이버 카페 게시글 URL
 * @returns {Object} 수집된 이슈 정보
 */
async function manualIngest(req, res) {
  try {
    const { url, cookies } = req.body;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return sendError(res, 'URL이 필요합니다.', HTTP_STATUS.BAD_REQUEST);
    }

    logger.info('[IngestionController] Manual ingest request', { 
      url,
      hasCookies: !!cookies 
    });

    const result = await ingestByUrl(url.trim(), cookies);

    return sendSuccess(res, result, '게시글이 성공적으로 수집되었습니다.');
  } catch (error) {
    logger.error('[IngestionController] Manual ingest failed', {
      error: error.message,
      stack: error.stack
    });

    return sendError(
      res,
      error.message || '게시글 수집에 실패했습니다.',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    );
  }
}

module.exports = {
  manualIngest
};









