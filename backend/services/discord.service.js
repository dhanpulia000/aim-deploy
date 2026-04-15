/**
 * Discord 웹훅 전송 서비스 (업무 알림용 + 파트너 영상 Embed)
 * POST to webhook URL with JSON body { content: "...", embeds: [...] }
 */

const axios = require('axios');
const logger = require('../utils/logger');

/** 플랫폼별 Embed 색상 (Decimal: 유튜브-빨강, 틱톡-검정, 인스타-핑크) */
const PARTNER_EMBED_COLORS = {
  youtube: 16711680,    // #FF0000
  tiktok: 0,            // #000000
  instagram: 14958303   // #E4405F
};

function getVideoUrlFromItem(item) {
  if (!item || !item.video) return '';
  const norm = item.video._normalized;
  if (norm && typeof norm.url === 'string' && norm.url.trim()) return norm.url.trim();
  const id = item.video.id?.videoId || item.video.id;
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return '';
}

function formatWorkNotificationText(workName, date, time, additionalMessage = null) {
  let text = `📋 업무 알림\n\n`;
  text += `업무명: ${workName}\n`;
  text += `날짜: ${date}\n`;
  text += `시간: ${time}`;
  if (additionalMessage) {
    text += `\n\n${additionalMessage}`;
  }
  return text;
}

/**
 * Discord 웹훅으로 업무 알림 전송
 * @param {string} webhookUrl - Discord 웹훅 URL
 * @param {string} workName - 업무명
 * @param {string} date - 날짜 (YYYY-MM-DD)
 * @param {string} time - 시간 (HH:mm)
 * @param {string|null} additionalMessage - 추가 메시지
 * @param {string|null} mention - Discord 멘션: @everyone, @here, <@USER_ID>, <@&ROLE_ID> (본문 앞에 붙음)
 * @returns {Promise<{ success: boolean }>}
 */
async function sendWorkNotification(webhookUrl, workName, date, time, additionalMessage = null, mention = null) {
  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
    throw new Error('Discord 웹훅 URL이 필요합니다.');
  }
  const url = webhookUrl.trim();
  if (!url.startsWith('https://discord.com/api/webhooks/') && !url.startsWith('https://discordapp.com/api/webhooks/')) {
    throw new Error('유효한 Discord 웹훅 URL이 아닙니다.');
  }

  let content = formatWorkNotificationText(workName, date, time, additionalMessage);
  if (mention && typeof mention === 'string' && mention.trim()) {
    content = mention.trim() + '\n\n' + content;
  }

  try {
    const response = await axios.post(
      url,
      { content },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
        maxContentLength: 2000 // Discord limit 2000 chars per message
      }
    );
    if (response.status >= 200 && response.status < 300) {
      logger.info('[DiscordService] Work notification sent', { webhookUrl: url.slice(0, 50) + '...', workName });
      return { success: true };
    }
    throw new Error(`Discord webhook returned ${response.status}`);
  } catch (error) {
    const statusCode = error.response?.status;
    const message = error.response?.data?.message || error.message;
    logger.error('[DiscordService] Failed to send', {
      workName,
      statusCode,
      error: message
    });
    const err = new Error(message || 'Discord 전송에 실패했습니다.');
    err.statusCode = statusCode;
    throw err;
  }
}

/**
 * 파트너 영상 아카이빙 결과를 Discord Embed로 전송 (플랫폼별 색상, 중복 전송 방지)
 * @param {string} webhookUrl - Discord 웹훅 URL
 * @param {Array} items - partner archiving items [{ video, channelName, username, period, ... }]
 * @param {Object} options - { skipSentCheck?: boolean, mention?: string, monthWeekLabel?: string }
 * @returns {Promise<{ success: boolean, sentCount: number, skippedCount: number }>}
 */
async function sendPartnerArchivingEmbed(webhookUrl, items, options = {}) {
  if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
    throw new Error('Discord 웹훅 URL이 필요합니다.');
  }
  const url = webhookUrl.trim();
  if (!url.startsWith('https://discord.com/api/webhooks/') && !url.startsWith('https://discordapp.com/api/webhooks/')) {
    throw new Error('유효한 Discord 웹훅 URL이 아닙니다.');
  }

  const partnerSentVideo = require('./partnerSentVideo.service');
  const monthWeekLabel = options.monthWeekLabel || '';

  let toSend = items;
  if (!options.skipSentCheck) {
    toSend = items.filter(item => {
      const key = partnerSentVideo.getVideoIdForSent(item);
      if (!key) return true;
      return !partnerSentVideo.isSent(key.platform, key.videoId);
    });
  }

  if (toSend.length === 0) {
    return { success: true, sentCount: 0, skippedCount: items.length };
  }

  const platformLabels = { youtube: '유튜브', tiktok: '틱톡', instagram: '인스타그램' };
  const byPlatform = new Map();
  for (const item of toSend) {
    const p = (item.video && item.video._normalized && item.video._normalized.platform) || 'youtube';
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p).push(item);
  }

  const embeds = [];
  for (const [platform, list] of byPlatform) {
    const color = PARTNER_EMBED_COLORS[platform] ?? 8421504;
    const platformName = platformLabels[platform] || platform;
    const title = monthWeekLabel ? `${platformName} · ${monthWeekLabel}` : `${platformName} 주간 영상`;
    const fields = list.slice(0, 25).map(item => {
      const titleText = (item.video.snippet && item.video.snippet.title) ? String(item.video.snippet.title).slice(0, 250) : '(제목 없음)';
      const link = getVideoUrlFromItem(item);
      const viewCount = item.video.statistics && item.video.statistics.viewCount ? item.video.statistics.viewCount : '0';
      const value = link ? `[보기](${link}) · 조회 ${viewCount}` : `조회 ${viewCount}`;
      return { name: titleText, value: value.slice(0, 1024), inline: false };
    });
    embeds.push({
      title,
      color,
      fields,
      timestamp: new Date().toISOString()
    });
  }

  let content = '';
  if (options.mention && String(options.mention).trim()) {
    content = options.mention.trim();
  }

  try {
    const payload = content ? { content, embeds } : { embeds };
    const response = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      maxContentLength: 10000
    });
    if (response.status >= 200 && response.status < 300) {
      for (const item of toSend) {
        const key = partnerSentVideo.getVideoIdForSent(item);
        if (key) partnerSentVideo.markSent(key.platform, key.videoId);
      }
      logger.info('[DiscordService] Partner archiving embed sent', { embeds: embeds.length, items: toSend.length });
      return { success: true, sentCount: toSend.length, skippedCount: items.length - toSend.length };
    }
    throw new Error(`Discord webhook returned ${response.status}`);
  } catch (error) {
    const statusCode = error.response?.status;
    const message = error.response?.data?.message || error.message;
    logger.error('[DiscordService] Partner archiving embed failed', { statusCode, error: message });
    const err = new Error(message || 'Discord Embed 전송에 실패했습니다.');
    err.statusCode = statusCode;
    throw err;
  }
}

module.exports = {
  sendWorkNotification,
  formatWorkNotificationText,
  sendPartnerArchivingEmbed,
  PARTNER_EMBED_COLORS
};
