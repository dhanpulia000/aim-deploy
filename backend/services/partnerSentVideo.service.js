/**
 * 파트너 영상 Discord 전송 이력 저장 (중복 전송 방지)
 * SQLite 테이블 PartnerSentVideo 사용
 */
const { queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

let _schemaEnsured = false;

function ensureSchema() {
  if (_schemaEnsured) return;
  if (/^postgres/i.test(process.env.DATABASE_URL || '')) {
    _schemaEnsured = true;
    return;
  }
  try {
    execute(`
      CREATE TABLE IF NOT EXISTS PartnerSentVideo (
        platform TEXT NOT NULL,
        videoId TEXT NOT NULL,
        sentAt TEXT NOT NULL,
        PRIMARY KEY (platform, videoId)
      )
    `);
    _schemaEnsured = true;
  } catch (e) {
    logger.warn('[PartnerSentVideo] Failed to ensure schema', { error: e.message });
    _schemaEnsured = true;
  }
}

/**
 * 영상 항목에서 전송 이력용 (platform, videoId) 추출
 * @param {Object} item - { video, channelName, ... }
 * @returns {{ platform: string, videoId: string }|null}
 */
function getVideoIdForSent(item) {
  if (!item || !item.video) return null;
  const norm = item.video._normalized;
  const platform = norm && norm.platform ? norm.platform : 'youtube';

  if (platform === 'youtube') {
    const id = item.video.id?.videoId || item.video.id;
    return id ? { platform: 'youtube', videoId: String(id) } : null;
  }
  if (platform === 'tiktok' || platform === 'instagram') {
    const url = norm && norm.url ? norm.url : '';
    if (!url) return null;
    // URL을 정규화하여 키로 사용 (쿼리 파라미터 제거)
    const normalized = url.split('?')[0].trim();
    return { platform, videoId: normalized };
  }
  return null;
}

/**
 * 이미 전송한 영상인지 확인
 * @param {string} platform - youtube | tiktok | instagram
 * @param {string} videoId - 플랫폼별 영상 ID 또는 URL
 * @returns {boolean}
 */
function isSent(platform, videoId) {
  ensureSchema();
  const row = queryOne(
    'SELECT 1 FROM PartnerSentVideo WHERE platform = ? AND videoId = ?',
    [platform, videoId]
  );
  return !!row;
}

/**
 * 전송 완료로 기록 (중복 전송 방지용)
 * @param {string} platform
 * @param {string} videoId
 */
function markSent(platform, videoId) {
  ensureSchema();
  const sentAt = new Date().toISOString();
  try {
    execute(
      'INSERT OR IGNORE INTO PartnerSentVideo (platform, videoId, sentAt) VALUES (?, ?, ?)',
      [platform, videoId, sentAt]
    );
  } catch (e) {
    logger.warn('[PartnerSentVideo] markSent failed', { platform, videoId, error: e.message });
  }
}

module.exports = {
  ensureSchema,
  getVideoIdForSent,
  isSent,
  markSent
};
