/**
 * playinzoi Discourse 포럼 JSON 수집 → RawLog → rawLogProcessor가 이슈 승격
 *
 * 카테고리별 /c/{slug}/{id}/l/latest.json 페이지네이션 후 토픽별 /t/{id}.json 본문 수집.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { nanoid } = require('nanoid');
const { queryOne, execute } = require('../../libs/db');
const logger = require('../../utils/logger');
const { DISCOURSE_PLAYINZOI_EXTERNAL_SOURCE } = require('../../services/naverCafeIssues.service');
const {
  htmlIndicatesImages,
  captureDiscourseTopicScreenshot
} = require('./lib/discourseTopicScreenshot');

const CONFIG_KEY_SCAN = 'discourse.inzoi.scanState';

const BASE_URL = (process.env.DISCOURSE_INZOI_BASE_URL || 'https://forum.playinzoi.com').replace(
  /\/$/,
  ''
);
const POLL_MS = parseInt(process.env.DISCOURSE_INZOI_POLL_MS, 10) || 300000;
const REQUEST_DELAY_MS = parseInt(process.env.DISCOURSE_INZOI_REQUEST_DELAY_MS, 10) || 600;
const MAX_TOPIC_FETCHES_PER_RUN = parseInt(process.env.DISCOURSE_INZOI_MAX_TOPIC_FETCHES_PER_RUN, 10) || 40;

/** 네이버 카페와 같이 본문 이미지가 있으면 Playwright로 .cooked 스크린샷 (false|0|no 로 끔) */
const SCREENSHOTS_ENABLED = !['0', 'false', 'no'].includes(
  String(process.env.DISCOURSE_INZOI_SCREENSHOTS ?? 'true').trim().toLowerCase()
);

const DEFAULT_UA =
  'AIMFORPH-DiscourseWorker/1.0 (+https://github.com; monitoring; respectful crawl)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function topicUrl(base, slug, id) {
  const s = slug || 'topic';
  return `${base}/t/${s}/${id}`;
}

function moreTopicsPathToJsonUrl(base, morePath) {
  // morePath: "/c/bug-reports/7/l/latest?page=3"
  const u = new URL(morePath, base);
  let p = u.pathname;
  if (!p.endsWith('.json')) {
    if (p.endsWith('/latest')) p += '.json';
    else p += '.json';
  }
  return `${base}${p}${u.search}`;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': process.env.DISCOURSE_INZOI_USER_AGENT || DEFAULT_UA,
      ...opts.headers
    },
    redirect: 'follow'
  });
  if (res.status === 429) {
    const err = new Error('HTTP 429');
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchJsonWithRetry(url) {
  let attempt = 0;
  for (;;) {
    try {
      return await fetchJson(url);
    } catch (e) {
      attempt += 1;
      if (e.status === 429 && attempt < 6) {
        const wait = Math.min(60000, 5000 * attempt);
        logger.warn('[DiscourseInzoi] Rate limited, backing off', { waitMs: wait, url });
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

function loadScanState() {
  try {
    const row = queryOne('SELECT value FROM MonitoringConfig WHERE key = ?', [CONFIG_KEY_SCAN]);
    if (!row?.value) return { categoryIndex: 0, page: 1 };
    const parsed = JSON.parse(row.value);
    return {
      categoryIndex: Math.max(0, parseInt(parsed.categoryIndex, 10) || 0),
      page: Math.max(1, parseInt(parsed.page, 10) || 1)
    };
  } catch (e) {
    logger.warn('[DiscourseInzoi] Failed to load scan state', { error: e.message });
    return { categoryIndex: 0, page: 1 };
  }
}

function saveScanState(state) {
  const now = new Date().toISOString();
  const value = JSON.stringify({
    categoryIndex: state.categoryIndex,
    page: state.page
  });
  execute(
    'INSERT OR REPLACE INTO MonitoringConfig (key, value, updatedAt) VALUES (?, ?, ?)',
    [CONFIG_KEY_SCAN, value, now]
  );
}

function getFirstPost(topicJson) {
  const posts = topicJson.post_stream?.posts || [];
  const p1 = posts.find((p) => p.post_number === 1);
  return p1 || posts[0] || null;
}

function issueExistsForTopic(topicId) {
  const row = queryOne(
    `SELECT id FROM ReportItemIssue 
     WHERE externalSource = ? AND externalPostId = ? LIMIT 1`,
    [DISCOURSE_PLAYINZOI_EXTERNAL_SOURCE, String(topicId)]
  );
  return !!row;
}

function rawLogExistsForTopic(topicId) {
  const row = queryOne(
    `SELECT id FROM RawLog WHERE source = ? AND articleId = ? LIMIT 1`,
    ['discourse', String(topicId)]
  );
  return !!row;
}

/** 토픽 JSON + 목록 행 + 카테고리에서 포럼 UI에 가까운 스냅샷 추출 */
function pickDiscourseForumSnapshot(topicJson, listTopic, cat) {
  const tags = topicJson.tags ?? listTopic?.tags;
  const tagList = Array.isArray(tags) ? tags : [];
  const views = topicJson.views ?? listTopic?.views;
  const likeCount = topicJson.like_count ?? listTopic?.like_count;
  const replyCount = topicJson.reply_count ?? listTopic?.reply_count;
  const postsCount = topicJson.posts_count ?? listTopic?.posts_count;
  const imageUrl = topicJson.image_url ?? listTopic?.image_url;
  const lastPostedAt = topicJson.last_posted_at ?? listTopic?.last_posted_at;
  const bumpedAt = topicJson.bumped_at ?? null;
  const topicCreatedAt = topicJson.created_at ?? listTopic?.created_at ?? null;
  let excerpt = topicJson.excerpt ?? listTopic?.excerpt;
  if (typeof excerpt === 'string') {
    excerpt = excerpt
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
  } else {
    excerpt = null;
  }
  const replies =
    typeof replyCount === 'number'
      ? replyCount
      : typeof postsCount === 'number'
        ? Math.max(0, postsCount - 1)
        : null;

  return {
    discourseTags: tagList,
    discourseViews: typeof views === 'number' ? views : null,
    discourseLikeCount: typeof likeCount === 'number' ? likeCount : null,
    discourseReplyCount: replies,
    discoursePostsCount: typeof postsCount === 'number' ? postsCount : null,
    discourseImageUrl: imageUrl || null,
    discourseLastPostedAt: lastPostedAt || null,
    discourseBumpedAt: bumpedAt || null,
    discourseTopicCreatedAt: topicCreatedAt || null,
    discourseCategoryName: cat?.name || null,
    discourseCategorySlug: cat?.slug || null,
    discourseExcerpt: excerpt || null
  };
}

async function saveRawLog({
  topicId,
  url,
  title,
  content,
  author,
  timestamp,
  categoryId,
  postsCount,
  slug,
  hasImages = false,
  screenshotPath = null,
  postImagePaths = null,
  forumSnapshot = {}
}) {
  const logId = nanoid();
  const now = new Date().toISOString();
  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now());
  const replyFromPosts = Math.max(0, (postsCount || 1) - 1);
  const metadata = {
    url,
    title,
    externalPostId: String(topicId),
    discourseCategoryId: categoryId,
    slug,
    commentCount:
      typeof forumSnapshot.discourseReplyCount === 'number'
        ? forumSnapshot.discourseReplyCount
        : replyFromPosts,
    isHotTopic: false,
    hasKeywordMatch: false,
    hasImages: Boolean(hasImages),
    ...(screenshotPath ? { screenshotPath } : {}),
    ...(postImagePaths && postImagePaths.length > 0 ? { postImagePaths } : {}),
    ...forumSnapshot
  };

  execute(
    `INSERT INTO RawLog (id, source, content, author, timestamp, isProcessed, processingStatus, metadata, boardId, articleId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      'discourse',
      content || '',
      author || null,
      ts.toISOString(),
      0,
      'NEW',
      JSON.stringify(metadata),
      categoryId || null,
      String(topicId),
      now,
      now
    ]
  );

  logger.info('[DiscourseInzoi] RawLog saved', { topicId, title: (title || '').slice(0, 60) });
}

async function loadPublicCategories() {
  const data = await fetchJsonWithRetry(`${BASE_URL}/categories.json`);
  const list = data.category_list?.categories || [];
  return list
    .filter((c) => !c.read_restricted && typeof c.id === 'number')
    .sort((a, b) => (a.position ?? a.id) - (b.position ?? b.id));
}

async function runScanCycle() {
  let categories;
  try {
    categories = await loadPublicCategories();
  } catch (e) {
    logger.error('[DiscourseInzoi] Failed to load categories', { error: e.message });
    return;
  }

  if (categories.length === 0) {
    logger.warn('[DiscourseInzoi] No public categories');
    return;
  }

  let state = loadScanState();
  let fetches = 0;
  let startedMidCategory = true;

  for (let ci = state.categoryIndex; ci < categories.length; ci += 1) {
    const cat = categories[ci];
    const listBase = `${BASE_URL}/c/${encodeURIComponent(cat.slug)}/${cat.id}/l/latest.json`;
    let page = startedMidCategory ? state.page : 1;
    startedMidCategory = false;
    let listFetchUrl = `${listBase}?page=${page}`;

    for (;;) {
      if (fetches >= MAX_TOPIC_FETCHES_PER_RUN) {
        saveScanState({ categoryIndex: ci, page });
        logger.info('[DiscourseInzoi] Paused scan (max fetches per run)', {
          categoryIndex: ci,
          page,
          fetches
        });
        return;
      }

      let listData;
      try {
        listData = await fetchJsonWithRetry(listFetchUrl);
      } catch (e) {
        logger.error('[DiscourseInzoi] List fetch failed', {
          url: listFetchUrl,
          error: e.message
        });
        saveScanState({ categoryIndex: ci, page });
        return;
      }

      await sleep(REQUEST_DELAY_MS);

      try {
        const u = new URL(listFetchUrl);
        const p = u.searchParams.get('page');
        if (p) page = parseInt(p, 10) || page;
      } catch (_) {
        /* ignore */
      }

      const topics = listData.topic_list?.topics || [];
      if (topics.length === 0) {
        state = { categoryIndex: ci + 1, page: 1 };
        saveScanState(state);
        break;
      }

      for (const topic of topics) {
        if (fetches >= MAX_TOPIC_FETCHES_PER_RUN) {
          saveScanState({ categoryIndex: ci, page });
          return;
        }

        const topicId = topic.id;
        if (issueExistsForTopic(topicId) || rawLogExistsForTopic(topicId)) {
          continue;
        }

        const url = topicUrl(BASE_URL, topic.slug, topicId);
        let topicJson;
        try {
          topicJson = await fetchJsonWithRetry(`${BASE_URL}/t/${topicId}.json`);
        } catch (e) {
          logger.warn('[DiscourseInzoi] Topic fetch failed', { topicId, error: e.message });
          await sleep(REQUEST_DELAY_MS);
          continue;
        }
        fetches += 1;
        await sleep(REQUEST_DELAY_MS);

        const first = getFirstPost(topicJson);
        const rawCookedHtml = first?.cooked || '';
        const cooked = stripHtml(rawCookedHtml);
        // Discourse 다국어: `title`은 로케일별 번역(예: zh_CN 「无征兆闪退」), `fancy_title`은 기본 표기(영문 등)인 경우가 많음
        const title =
          topicJson.fancy_title ||
          topic.fancy_title ||
          topicJson.title ||
          topic.title ||
          '제목 없음';
        const author = first?.username || null;
        const createdAt = topicJson.created_at || first?.created_at || new Date().toISOString();
        const postsCount = topicJson.posts_count || topic.posts_count || 1;

        let hasImages = false;
        let screenshotPath = null;
        let postImagePaths = null;
        if (SCREENSHOTS_ENABLED) {
          if (htmlIndicatesImages(rawCookedHtml)) {
            hasImages = true;
            const cap = await captureDiscourseTopicScreenshot({
              topicId,
              url,
              userAgent: process.env.DISCOURSE_INZOI_USER_AGENT || DEFAULT_UA
            });
            if (cap.screenshotPath) screenshotPath = cap.screenshotPath;
            if (cap.postImagePaths && cap.postImagePaths.length > 0) {
              postImagePaths = cap.postImagePaths;
            }
            if (cap.screenshotPath === null && cap.hasImages === false) {
              hasImages = false;
              postImagePaths = null;
            }
          }
        }

        const forumSnapshot = pickDiscourseForumSnapshot(topicJson, topic, cat);

        try {
          await saveRawLog({
            topicId,
            url,
            title,
            content: cooked,
            author,
            timestamp: createdAt,
            categoryId: cat.id,
            postsCount,
            slug: topicJson.slug || topic.slug,
            hasImages,
            screenshotPath,
            postImagePaths,
            forumSnapshot
          });
        } catch (err) {
          logger.error('[DiscourseInzoi] RawLog insert failed', {
            topicId,
            error: err.message
          });
        }
      }

      const perPage = listData.topic_list.per_page || 30;
      const more = listData.topic_list.more_topics_url;
      if (topics.length < perPage && !more) {
        state = { categoryIndex: ci + 1, page: 1 };
        saveScanState(state);
        break;
      }

      if (more) {
        listFetchUrl = moreTopicsPathToJsonUrl(BASE_URL, more);
        try {
          const nu = new URL(listFetchUrl);
          const np = nu.searchParams.get('page');
          if (np) page = parseInt(np, 10) || page;
        } catch (_) {
          page += 1;
        }
      } else {
        page += 1;
        listFetchUrl = `${listBase}?page=${page}`;
      }

      saveScanState({ categoryIndex: ci, page });
    }
  }

  saveScanState({ categoryIndex: 0, page: 1 });
  logger.info('[DiscourseInzoi] Full category sweep completed; reset scan cursor', {
    topicsFetchedThisRun: fetches
  });
}

async function mainLoop() {
  logger.info('[DiscourseInzoi] Worker started', {
    baseUrl: BASE_URL,
    pollMs: POLL_MS,
    requestDelayMs: REQUEST_DELAY_MS,
    maxTopicFetchesPerRun: MAX_TOPIC_FETCHES_PER_RUN,
    screenshotsEnabled: SCREENSHOTS_ENABLED
  });

  for (;;) {
    try {
      await runScanCycle();
    } catch (e) {
      logger.error('[DiscourseInzoi] Scan cycle error', { error: e.message, stack: e.stack });
    }
    await sleep(POLL_MS);
  }
}

mainLoop().catch((e) => {
  logger.error('[DiscourseInzoi] Fatal', { error: e.message });
  process.exit(1);
});
