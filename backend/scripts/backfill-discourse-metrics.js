/**
 * Discourse(playinzoi) 이슈에 replies/likes/views 백필:
 * - ReportItemIssue(externalSource=DISCOURSE_PLAYINZOI) 중 discourseViews/Like/Reply 가 비어있는 항목을 대상으로
 * - (1) 우선 issue.detail 상단의 Discourse 프리앰블(조회/좋아요/답글)을 파싱하여 업데이트
 * - (2) 프리앰블이 없으면 RawLog(source='discourse', articleId=externalPostId)의 metadata를 시도
 *
 * 사용:
 *   cd backend
 *   node scripts/backfill-discourse-metrics.js
 *
 * 옵션 env:
 *   DISCOURSE_METRICS_BACKFILL_LIMIT=500
 *   DISCOURSE_METRICS_BACKFILL_DELAY_MS=30
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = require('../utils/logger');
const { Client } = require('pg');

const LIMIT = parseInt(process.env.DISCOURSE_METRICS_BACKFILL_LIMIT || '500', 10) || 500;
const DELAY_MS = parseInt(process.env.DISCOURSE_METRICS_BACKFILL_DELAY_MS || '30', 10) || 30;
const DEBUG = ['1', 'true', 'yes'].includes(
  String(process.env.DISCOURSE_METRICS_BACKFILL_DEBUG || '').trim().toLowerCase()
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function parseMetadata(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseFromIssueDetail(detail) {
  if (!detail || typeof detail !== 'string') return { views: null, likes: null, replies: null };
  const head = detail.split('\n').slice(0, 60).join('\n');
  if (!head.includes('Discourse (inZOI Forums)')) return { views: null, likes: null, replies: null };

  const getNum = (re) => {
    const m = head.match(re);
    if (!m) return null;
    const n = parseInt(String(m[1]).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  return {
    views: getNum(/조회\s+([\d,]+)/),
    likes: getNum(/좋아요\s+([\d,]+)/),
    replies: getNum(/답글\s+([\d,]+)/)
  };
}

async function main() {
  logger.info('[DiscourseMetricsBackfill] start', { LIMIT, DELAY_MS });

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is missing');
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  // 1) 대상 이슈 1차 조회 (join 없이 가볍게)
  const issuesRes = await client.query(
    `
    SELECT
      i."id",
      i."externalPostId",
      i."sourceUrl",
      i."discourseViews",
      i."discourseLikeCount",
      i."discourseReplyCount",
      i."detail" as "issueDetail"
    FROM "ReportItemIssue" i
    WHERE i."externalSource" = $1
      AND (
        i."discourseViews" IS NULL
        OR i."discourseLikeCount" IS NULL
        OR i."discourseReplyCount" IS NULL
      )
    ORDER BY i."createdAt" DESC
    LIMIT $2
  `,
    ['DISCOURSE_PLAYINZOI', LIMIT]
  );
  const rows = issuesRes.rows || [];

  if (!rows || rows.length === 0) {
    logger.info('[DiscourseMetricsBackfill] no targets');
    await client.end();
    return;
  }

  // 2) RawLog metadata를 한 번에 로드 (externalPostId/sourceUrl 기준)
  const extIds = [...new Set(rows.map((r) => (r.externalPostId != null ? String(r.externalPostId) : '')).filter(Boolean))];
  const urls = [...new Set(rows.map((r) => (r.sourceUrl != null ? String(r.sourceUrl) : '')).filter(Boolean))];
  const rawMap = new Map(); // key(externalPostId or url) -> metadata(jsonb)
  if (extIds.length > 0 || urls.length > 0) {
    const rawRes = await client.query(
      `
      SELECT
        r."articleId",
        (r."metadata"::jsonb ->> 'externalPostId') as "metaExternalPostId",
        (r."metadata"::jsonb ->> 'url') as "metaUrl",
        r."metadata"::jsonb as "meta"
      FROM "RawLog" r
      WHERE r."source" = 'discourse'
        AND r."metadata" IS NOT NULL
        AND (
          (r."articleId" IS NOT NULL AND r."articleId" = ANY($1::text[]))
          OR ((r."metadata"::jsonb ->> 'externalPostId') IS NOT NULL AND (r."metadata"::jsonb ->> 'externalPostId') = ANY($1::text[]))
          OR ((r."metadata"::jsonb ->> 'url') IS NOT NULL AND (r."metadata"::jsonb ->> 'url') = ANY($2::text[]))
        )
    `,
      [extIds, urls]
    );
    for (const r of rawRes.rows || []) {
      const meta = r.meta || null;
      const k1 = r.articleId != null ? String(r.articleId) : null;
      const k2 = r.metaExternalPostId != null ? String(r.metaExternalPostId) : null;
      const k3 = r.metaUrl != null ? String(r.metaUrl) : null;
      if (k1 && meta) rawMap.set(k1, meta);
      if (k2 && meta) rawMap.set(k2, meta);
      if (k3 && meta) rawMap.set(k3, meta);
    }
  }

  if (DEBUG) {
    const preview = rows.slice(0, Math.min(5, rows.length)).map((r) => ({
      id: r.id,
      externalPostId: r.externalPostId,
      hasIssueDetail: typeof r.issueDetail === 'string' && r.issueDetail.length > 0,
      detailHasPreamble:
        typeof r.issueDetail === 'string' && r.issueDetail.includes('Discourse (inZOI Forums)'),
      detailHead: typeof r.issueDetail === 'string' ? r.issueDetail.split('\n').slice(0, 8).join('\n') : null,
      hasRawMetadata:
        rawMap.has(String(r.externalPostId || '')) || rawMap.has(String(r.sourceUrl || ''))
    }));
    console.log('[DiscourseMetricsBackfill] debug preview', preview);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    // 1) issue.detail 프리앰블 파싱
    const fromDetail = parseFromIssueDetail(row.issueDetail);
    let views = safeIntOrNull(fromDetail.views);
    let likes = safeIntOrNull(fromDetail.likes);
    let replies = safeIntOrNull(fromDetail.replies);

    // 2) 그래도 없으면 RawLog metadata 시도
    if (views === null && likes === null && replies === null) {
      const meta =
        rawMap.get(String(row.externalPostId || '')) ||
        rawMap.get(String(row.sourceUrl || '')) ||
        null;
      if (meta && typeof meta === 'object') {
        views = safeIntOrNull(meta.discourseViews);
        likes = safeIntOrNull(meta.discourseLikeCount);
        replies = safeIntOrNull(meta.discourseReplyCount);
      }
    }

    // 메타에도 없으면 스킵
    if (views === null && likes === null && replies === null) {
      skipped += 1;
      continue;
    }

    try {
      const now = new Date().toISOString();
      await client.query(
        `
        UPDATE "ReportItemIssue"
           SET "discourseViews" = COALESCE("discourseViews", $1),
               "discourseLikeCount" = COALESCE("discourseLikeCount", $2),
               "discourseReplyCount" = COALESCE("discourseReplyCount", $3),
               "updatedAt" = $4
         WHERE "id" = $5
      `,
        [views, likes, replies, now, row.id]
      );
      ok += 1;
    } catch (e) {
      failed += 1;
      logger.warn('[DiscourseMetricsBackfill] update failed', {
        issueId: row.id,
        error: e.message
      });
    }

    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  logger.info('[DiscourseMetricsBackfill] done', { ok, skipped, failed, total: rows.length });
  await client.end();
}

main().catch((e) => {
  logger.error('[DiscourseMetricsBackfill] fatal', { error: e.message, stack: e.stack });
  process.exit(1);
});

