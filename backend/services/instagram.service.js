const axios = require('axios');
const logger = require('../utils/logger');
const { getWeeklyPeriod } = require('../utils/periodUtils');

function extractUsernameFromInstagram(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.startsWith('@')) return s.slice(1);

  // https://www.instagram.com/username/
  const m1 = s.match(/instagram\.com\/([^/?#]+)/i);
  if (m1) {
    const u = m1[1].toLowerCase();
    if (u !== 'p' && u !== 'reel' && u !== 'reels' && u !== 'stories' && u !== 'explore') return m1[1];
  }

  if (/^[a-zA-Z0-9._]+$/.test(s)) return s;
  return null;
}

function toInstagramProfileUrl(username) {
  return `https://www.instagram.com/${username}/`;
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
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Apify Instagram Post Scraper 출력 항목을 공통 video 형식으로 정규화
 * (apify/instagram-post-scraper 등 다양한 스키마 대응)
 */
function normalizeApifyItemToVideo(item) {
  const url =
    pickFirstString(item, ['url', 'postUrl', 'permalink', 'link', 'shortCode']) ||
    (item && item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : '') ||
    '';

  const title =
    pickFirstString(item, ['caption', 'captionText', 'description', 'text', 'title']) || '';

  const publishedAt =
    parseApifyDate(
      (item && (item.timestamp || item.takenAt || item.createdTime || item.date || item.created_at)) ||
      (item && item.node && (item.node.timestamp || item.node.taken_at_timestamp))
    );

  const likes = (item && (item.likesCount ?? item.likes ?? item.likeCount)) ?? (item && item.node && item.node.edge_liked_by?.count);
  const comments = (item && (item.commentsCount ?? item.comments ?? item.commentCount)) ?? (item && item.node && item.node.edge_media_to_comment?.count);
  const views = (item && (item.videoViewCount ?? item.viewsCount ?? item.playCount ?? item.viewCount)) ?? (item && item.node && item.node.video_view_count);

  const likeCount = safeNumber(likes, 0);
  const commentCount = safeNumber(comments, 0);
  const viewCount = safeNumber(views, 0);

  return {
    platform: 'instagram',
    title,
    url: url || (item && item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : ''),
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
        fields: 'id,caption,url,timestamp,likesCount,commentsCount,videoViewCount'
      },
      timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json' }
    });
    return Array.isArray(res.data) ? res.data : [];
  } catch (error) {
    const status = error.response?.status;
    const body = error.response?.data;
    logger.error('Apify Instagram actor run failed', {
      status,
      actorId,
      message: error.message,
      response: typeof body === 'string' ? body.slice(0, 500) : body
    });
    throw new Error(`Apify Instagram actor run failed${status ? ` (HTTP ${status})` : ''}: ${error.message}`);
  }
}

/**
 * 인스타그램 크리에이터의 주간 포스트/릴스 메타데이터 수집 (Apify 기반)
 * @param {Object} opts
 * @param {string} opts.creator - @username 또는 프로필 URL
 * @param {Date} opts.date - 기준 날짜
 * @param {string} opts.partnerName - 파트너명
 * @param {string} opts.liveUrl - 라이브 URL(선택)
 */
async function collectWeeklyCreatorMetadataApify({ creator, date = new Date(), partnerName, liveUrl = '' }) {
  const token = process.env.INSTAGRAM_APIFY_API_TOKEN || process.env.TIKTOK_APIFY_API_TOKEN;
  const actorId = process.env.INSTAGRAM_APIFY_ACTOR_ID || 'apify/instagram-post-scraper';

  if (!token) {
    throw new Error('Missing INSTAGRAM_APIFY_API_TOKEN (or TIKTOK_APIFY_API_TOKEN) in server configuration');
  }

  const username = extractUsernameFromInstagram(creator);
  const profileInput = username ? username : String(creator).trim();
  const profileUrl = toInstagramProfileUrl(profileInput);

  const period = getWeeklyPeriod(date);
  const start = new Date(period.startDate);
  const end = new Date(period.endDate);

  logger.info('Collecting Instagram weekly metadata via Apify', {
    actorId,
    partnerName,
    profileUrl,
    period
  });

  // apify/instagram-post-scraper: directUrls(또는 username), resultsType, resultsLimit, 주거용 프록시
  const actorInput = {
    directUrls: [profileUrl],
    resultsType: 'posts',
    resultsLimit: 10,
    addParentData: false,
    onlyPostsNewerThan: period.startDateFormatted,
    proxyConfiguration: {
      useApifyProxy: true,
      groups: ['RESIDENTIAL']
    }
  };

  const items = await runApifyActorAndGetItems({ actorId, token, input: actorInput });

  const videos = items
    .map(normalizeApifyItemToVideo)
    .filter(v => v && (v.url || v.title))
    .filter(v => {
      if (!v.publishedAt) return true;
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
          platform: 'instagram',
          url: v.url || ''
        }
      },
      channelName: partnerName || username || 'Instagram',
      username: username ? `@${username}` : '',
      liveUrl: liveUrl || '',
      weekNumber: period.weekNumber,
      period
    }));

  logger.info('Instagram weekly metadata collected', { partnerName, count: videos.length });

  return { videos, period };
}

module.exports = {
  extractUsernameFromInstagram,
  collectWeeklyCreatorMetadataApify,
  normalizeApifyItemToVideo
};
