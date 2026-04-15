const axios = require('axios');
const logger = require('../utils/logger');
const { getWeeklyPeriod } = require('../utils/periodUtils');

function extractUsernameFromTikTok(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('@')) return s.slice(1);

  // https://www.tiktok.com/@username
  const m1 = s.match(/tiktok\.com\/@([^/?#]+)/i);
  if (m1) return m1[1];

  // https://www.tiktok.com/@username/video/123
  const m2 = s.match(/tiktok\.com\/@([^/?#]+)\/video\/\d+/i);
  if (m2) return m2[1];

  // If it's just a bare username
  if (/^[a-zA-Z0-9._-]+$/.test(s)) return s;
  return null;
}

function toTikTokProfileUrl(username) {
  return `https://www.tiktok.com/@${username}`;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickFirstString(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseApifyDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  // Sometimes actors return epoch seconds
  if (typeof value === 'number') {
    // Heuristic: treat < 1e12 as seconds
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeApifyItemToVideo(item) {
  // Try a few common Apify TikTok actor schemas
  const url =
    pickFirstString(item, ['url', 'webVideoUrl', 'videoUrl', 'shareUrl']) ||
    (item && item.video && pickFirstString(item.video, ['url', 'downloadAddr', 'playAddr'])) ||
    '';

  const title =
    pickFirstString(item, ['desc', 'description', 'text', 'title']) ||
    (item && item.video && pickFirstString(item.video, ['desc', 'description'])) ||
    '';

  const publishedAt =
    parseApifyDate(
      (item && (item.createTime || item.createTimeISO || item.publishedAt || item.createTimeUnix)) ||
      (item && item.video && (item.video.createTime || item.video.createTimeISO))
    );

  const stats = (item && (item.stats || item.statistics)) || (item && item.video && (item.video.stats || item.video.statistics)) || {};

  const viewCount = safeNumber(
    stats.playCount ?? stats.viewCount ?? item.playCount ?? item.viewCount ?? (item && item.video && item.video.playCount),
    0
  );
  const likeCount = safeNumber(
    stats.diggCount ?? stats.likeCount ?? item.diggCount ?? item.likeCount ?? (item && item.video && item.video.diggCount),
    0
  );
  const commentCount = safeNumber(
    stats.commentCount ?? item.commentCount ?? (item && item.video && item.video.commentCount),
    0
  );

  return {
    platform: 'tiktok',
    title,
    url,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    statistics: {
      viewCount,
      likeCount,
      commentCount
    }
  };
}

async function runApifyActorAndGetItems({ actorId, token, input, timeoutMs = 300000 }) {
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`;
  try {
    const res = await axios.post(url, input, {
      params: {
        token,
        format: 'json',
        clean: true,
        memory: 1024,
        fields: 'id,text,url,desc,createTime,playCount,diggCount,commentCount'
      },
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    // Items are returned as JSON array
    return Array.isArray(res.data) ? res.data : [];
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    logger.error('Apify actor run failed', {
      status,
      actorId,
      message: error.message,
      response: typeof body === 'string' ? body.slice(0, 500) : body
    });
    throw new Error(`Apify actor run failed${status ? ` (HTTP ${status})` : ''}: ${error.message}`);
  }
}

/**
 * TikTok 크리에이터의 주간 영상 메타데이터 수집 (Apify 기반)
 * - Apify actor가 "프로필 URL" 입력으로 최신 영상들을 반환한다고 가정하고,
 *   반환된 결과를 주간 기간으로 필터링한다.
 *
 * @param {Object} opts
 * @param {string} opts.creator - TikTok @username 또는 프로필 URL
 * @param {Date} opts.date - 기준 날짜
 * @param {string} opts.partnerName - 엑셀의 채널명/파트너명
 * @param {string} opts.liveUrl - 라이브 URL(선택)
 * @returns {Promise<{ videos: Array, period: Object }>}
 */
// Apify TikTok 액터별 입력 스키마
// - gratenes/tiktok-media-and-metadata-retriever: input.url (프로필 URL)
// - clockworks/tiktok-scraper: input.profiles (유저네임 배열), 프로필 기준 영상 수집
// - clockworks/tiktok-video-scraper: input.postURLs (영상 URL만) → 프로필 수집 불가이므로 clockworks/tiktok-scraper로 대체
const GRATENES_ACTOR = 'gratenes/tiktok-media-and-metadata-retriever';
const CLOCKWORKS_SCRAPER = 'clockworks/tiktok-scraper';
const CLOCKWORKS_VIDEO_SCRAPER = 'clockworks/tiktok-video-scraper';

async function collectWeeklyCreatorMetadataApify({ creator, date = new Date(), partnerName, liveUrl = '' }) {
  const token = process.env.TIKTOK_APIFY_API_TOKEN;
  const envActorId = (process.env.TIKTOK_APIFY_ACTOR_ID || '').trim();

  if (!token) {
    throw new Error('Missing TIKTOK_APIFY_API_TOKEN in server configuration');
  }

  const username = extractUsernameFromTikTok(creator);
  if (!username) {
    throw new Error('틱톡 유저네임 또는 프로필 URL을 입력해주세요.');
  }
  const profileUrl = toTikTokProfileUrl(username);

  const period = getWeeklyPeriod(date);
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);

  // clockworks/tiktok-video-scraper는 postURLs(영상 URL) 전용 → 프로필 수집용으로는 clockworks/tiktok-scraper 사용
  let actorId = envActorId || GRATENES_ACTOR;
  if (actorId === CLOCKWORKS_VIDEO_SCRAPER) {
    logger.warn('TIKTOK_APIFY_ACTOR_ID=tiktok-video-scraper is for video URLs only; using tiktok-scraper for profile collection', {
      configured: CLOCKWORKS_VIDEO_SCRAPER,
      using: CLOCKWORKS_SCRAPER
    });
    actorId = CLOCKWORKS_SCRAPER;
  }

  logger.info('Collecting TikTok weekly metadata via Apify', {
    actorId,
    partnerName,
    profileUrl,
    period
  });

  let input;
  if (actorId === CLOCKWORKS_SCRAPER) {
    // clockworks/tiktok-scraper: 프로필 URL, resultsPerPage, downloadVideos 차단, 주거용 프록시
    const startStr = period.startDate.slice(0, 10);
    const endStr = period.endDate.slice(0, 10);
    input = {
      profiles: [profileUrl],
      resultsPerPage: 20,
      downloadVideos: false,
      excludeReplies: true,
      profileScrapeSections: ['videos'],
      profileSorting: 'latest',
      oldestPostDateUnified: startStr,
      newestPostDate: endStr,
      proxyConfiguration: {
        useApifyProxy: true,
        groups: ['RESIDENTIAL']
      }
    };
  } else {
    // gratenes/tiktok-media-and-metadata-retriever 또는 기본값
    if (actorId !== GRATENES_ACTOR) {
      actorId = GRATENES_ACTOR;
      if (envActorId) {
        logger.warn('TIKTOK_APIFY_ACTOR_ID not supported for profile collection, using gratenes', {
          configured: envActorId,
          using: actorId
        });
      }
    }
    input = { url: profileUrl };
  }

  const items = await runApifyActorAndGetItems({ actorId, token, input });

  const videos = items
    .map(normalizeApifyItemToVideo)
    .filter(v => v && v.url)
    .filter(v => {
      if (!v.publishedAt) return true; // if unknown, keep (better than dropping silently)
      const t = new Date(v.publishedAt);
      return t >= start && t <= end;
    })
    .map(v => ({
      video: {
        id: null,
        snippet: {
          title: v.title || '',
          publishedAt: v.publishedAt || null
        },
        statistics: {
          viewCount: String(v.statistics.viewCount ?? 0),
          likeCount: String(v.statistics.likeCount ?? 0),
          commentCount: String(v.statistics.commentCount ?? 0)
        },
        _normalized: {
          platform: 'tiktok',
          url: v.url
        }
      },
      channelName: partnerName || username || 'TikTok',
      username: username ? `@${username}` : '',
      liveUrl: liveUrl || '',
      weekNumber: period.weekNumber,
      period
    }));

  logger.info('TikTok weekly metadata collected', {
    partnerName,
    count: videos.length
  });

  return { videos, period };
}

module.exports = {
  extractUsernameFromTikTok,
  collectWeeklyCreatorMetadataApify,
  normalizeApifyItemToVideo
};

