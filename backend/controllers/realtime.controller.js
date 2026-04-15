/**
 * Realtime / WebSocket 브로드캐스트 API
 */

const { sendError, HTTP_STATUS } = require('../utils/http');
const { asyncMiddleware } = require('../middlewares/async.middleware');
const logger = require('../utils/logger');
const publisher = require('../realtime/publisher');

/**
 * 즉시 브로드캐스트
 * POST /api/realtime/broadcast
 * Body: { type: string, payload?: object }
 */
const broadcast = asyncMiddleware(async (req, res) => {
  const { type, payload } = req.body || {};

  if (!type || typeof type !== 'string') {
    return sendError(res, 'type is required (string)', HTTP_STATUS.BAD_REQUEST);
  }

  const pl = payload != null && typeof payload === 'object' ? payload : {};
  publisher.broadcastImmediate(type, pl);

  logger.debug('Realtime broadcast (HTTP)', { type, hasPayload: Object.keys(pl).length > 0 });
  res.status(HTTP_STATUS.NO_CONTENT).end();
});

module.exports = {
  broadcast
};
