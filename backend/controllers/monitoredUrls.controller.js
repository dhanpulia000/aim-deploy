const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { sendSuccess, sendError, sendValidationError, HTTP_STATUS } = require('../utils/http');
const { isValidCrawlerGameCode } = require('../services/crawlerGames.service');

/**
 * 모니터링 URL 목록 조회
 */
async function listMonitoredUrls(req, res) {
  try {
    const urls = query(
      'SELECT * FROM MonitoredUrl ORDER BY enabled DESC, createdAt DESC',
      []
    );
    
    // 각 URL의 이슈 개수 조회
    const urlIds = urls.map(u => u.id);
    const issueCounts = {};
    if (urlIds.length > 0) {
      const placeholders = urlIds.map(() => '?').join(',');
      const counts = query(
        `SELECT monitoredUrlId, COUNT(*) as count FROM ReportItemIssue WHERE monitoredUrlId IN (${placeholders}) GROUP BY monitoredUrlId`,
        urlIds
      );
      counts.forEach(c => {
        issueCounts[c.monitoredUrlId] = c.count;
      });
    }

    const urlsWithCounts = urls.map(url => ({
      ...url,
      enabled: Boolean(url.enabled),
      issueCount: issueCounts[url.id] || 0
    }));

    sendSuccess(res, urlsWithCounts, 'Monitored URLs retrieved successfully');
  } catch (error) {
    logger.error('Failed to list monitored URLs', { error: error.message });
    sendError(res, 'Failed to list monitored URLs', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 모니터링 URL 생성
 */
async function createMonitoredUrl(req, res) {
  try {
    const { url, cafeGame, label, enabled, interval, projectId } = req.body;

    if (!url || !cafeGame) {
      return sendValidationError(res, [
        { field: 'url', message: 'URL is required' },
        { field: 'cafeGame', message: 'cafeGame is required' }
      ]);
    }

    if (!isValidCrawlerGameCode(cafeGame)) {
      return sendValidationError(res, [
        { field: 'cafeGame', message: 'cafeGame must be a valid CRAWLER_GAME SystemCode' }
      ]);
    }

    const now = new Date().toISOString();
    const result = execute(
      'INSERT INTO MonitoredUrl (url, cafeGame, label, enabled, interval, projectId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        url,
        cafeGame,
        label || null,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        interval || 60,
        projectId || null,
        now,
        now
      ]
    );

    const monitoredUrl = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [result.lastInsertRowid]);
    logger.info('Monitored URL created', { id: monitoredUrl.id, url: monitoredUrl.url });
    sendSuccess(res, monitoredUrl, 'Monitored URL created successfully', HTTP_STATUS.CREATED);
  } catch (error) {
    logger.error('Failed to create monitored URL', { error: error.message });
    sendError(res, 'Failed to create monitored URL', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 모니터링 URL 수정
 */
async function updateMonitoredUrl(req, res) {
  try {
    const { id } = req.params;
    const { url, cafeGame, label, enabled, interval, projectId } = req.body;

    const updateFields = [];
    const params = [];
    
    if (url !== undefined) {
      updateFields.push('url = ?');
      params.push(url);
    }
    if (cafeGame !== undefined) {
      if (!isValidCrawlerGameCode(cafeGame)) {
        return sendValidationError(res, [
          { field: 'cafeGame', message: 'cafeGame must be a valid CRAWLER_GAME SystemCode' }
        ]);
      }
      updateFields.push('cafeGame = ?');
      params.push(cafeGame);
    }
    if (label !== undefined) {
      updateFields.push('label = ?');
      params.push(label);
    }
    if (enabled !== undefined) {
      updateFields.push('enabled = ?');
      params.push(enabled ? 1 : 0);
    }
    if (interval !== undefined) {
      updateFields.push('interval = ?');
      params.push(interval);
    }
    if (projectId !== undefined) {
      updateFields.push('projectId = ?');
      params.push(projectId || null);
    }
    
    if (updateFields.length === 0) {
      const monitoredUrl = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [parseInt(id)]);
      return sendSuccess(res, monitoredUrl, 'Monitored URL updated successfully');
    }
    
    updateFields.push('updatedAt = ?');
    params.push(new Date().toISOString());
    params.push(parseInt(id));
    
    execute(
      `UPDATE MonitoredUrl SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );

    const monitoredUrl = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [parseInt(id)]);
    logger.info('Monitored URL updated', { id: monitoredUrl.id });
    sendSuccess(res, monitoredUrl, 'Monitored URL updated successfully');
  } catch (error) {
    logger.error('Failed to update monitored URL', { error: error.message });
    sendError(res, 'Failed to update monitored URL', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

/**
 * 모니터링 URL 삭제
 */
async function deleteMonitoredUrl(req, res) {
  try {
    const { id } = req.params;

    const url = queryOne('SELECT * FROM MonitoredUrl WHERE id = ?', [parseInt(id)]);
    if (!url) {
      return sendError(res, 'Monitored URL not found', HTTP_STATUS.NOT_FOUND);
    }

    execute('DELETE FROM MonitoredUrl WHERE id = ?', [parseInt(id)]);

    logger.info('Monitored URL deleted', { id });
    sendSuccess(res, { id }, 'Monitored URL deleted successfully');
  } catch (error) {
    logger.error('Failed to delete monitored URL', { error: error.message });
    sendError(res, 'Failed to delete monitored URL', HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
}

module.exports = {
  listMonitoredUrls,
  createMonitoredUrl,
  updateMonitoredUrl,
  deleteMonitoredUrl
};
