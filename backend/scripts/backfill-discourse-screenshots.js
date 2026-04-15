/**
 * Discourse(playinzoi) 이슈에 스크린샷 백필:
 * - ReportItemIssue(externalSource=DISCOURSE_PLAYINZOI) 중 screenshotPath가 없는 항목을 대상으로
 * - 공개 토픽 페이지의 첫 게시글(.cooked) 전체를 Playwright로 캡처하여 uploads 경로에 저장
 * - ReportItemIssue.screenshotPath 업데이트
 *
 * 사용:
 *   cd backend
 *   npx playwright install   # 최초 1회 필요
 *   node scripts/backfill-discourse-screenshots.js
 *
 * 옵션 env:
 *   DISCOURSE_BACKFILL_LIMIT=50
 *   DISCOURSE_BACKFILL_DELAY_MS=800
 *   DISCOURSE_BACKFILL_ONLY_HAS_IMAGES=true
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { query, execute } = require('../libs/db');
const logger = require('../utils/logger');
const { captureDiscourseTopicScreenshot } = require('../workers/monitoring/lib/discourseTopicScreenshot');

const LIMIT = parseInt(process.env.DISCOURSE_BACKFILL_LIMIT || '50', 10) || 50;
const DELAY_MS = parseInt(process.env.DISCOURSE_BACKFILL_DELAY_MS || '800', 10) || 800;
const ONLY_HAS_IMAGES = ['1', 'true', 'yes'].includes(
  String(process.env.DISCOURSE_BACKFILL_ONLY_HAS_IMAGES || 'true').trim().toLowerCase()
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickUrl(issue) {
  return issue.sourceUrl || issue.link || null;
}

async function main() {
  logger.info('[DiscourseBackfill] start', { LIMIT, DELAY_MS, ONLY_HAS_IMAGES });

  const whereHasImages = ONLY_HAS_IMAGES ? 'AND hasImages = 1' : '';
  const rows = query(
    `SELECT id, sourceUrl, link, externalPostId, externalSource, screenshotPath, hasImages
     FROM ReportItemIssue
     WHERE externalSource = ?
       AND (screenshotPath IS NULL OR screenshotPath = '')
       ${whereHasImages}
     ORDER BY createdAt DESC
     LIMIT ?`,
    ['DISCOURSE_PLAYINZOI', LIMIT]
  );

  if (!rows || rows.length === 0) {
    logger.info('[DiscourseBackfill] no targets');
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const issue of rows) {
    const url = pickUrl(issue);
    const topicId = issue.externalPostId || issue.id;
    if (!url) {
      skipped += 1;
      logger.warn('[DiscourseBackfill] skip: no url', { issueId: issue.id });
      continue;
    }

    logger.info('[DiscourseBackfill] capturing', { issueId: issue.id, topicId, url });
    const cap = await captureDiscourseTopicScreenshot({
      topicId,
      url,
      userAgent:
        process.env.DISCOURSE_INZOI_USER_AGENT ||
        'AIMFORPH-DiscourseScreenshotBackfill/1.0 (+https://github.com; monitoring; respectful crawl)'
    });

    if (cap && cap.screenshotPath) {
      const now = new Date().toISOString();
      const pathsJson =
        cap.postImagePaths && cap.postImagePaths.length > 0
          ? JSON.stringify(cap.postImagePaths)
          : null;
      if (pathsJson) {
        execute(
          'UPDATE ReportItemIssue SET screenshotPath = ?, postImagePaths = ?, updatedAt = ? WHERE id = ?',
          [cap.screenshotPath, pathsJson, now, issue.id]
        );
      } else {
        execute('UPDATE ReportItemIssue SET screenshotPath = ?, updatedAt = ? WHERE id = ?', [
          cap.screenshotPath,
          now,
          issue.id
        ]);
      }
      ok += 1;
      logger.info('[DiscourseBackfill] saved', {
        issueId: issue.id,
        screenshotPath: cap.screenshotPath,
        postImageCount: cap.postImagePaths?.length || 0
      });
    } else {
      failed += 1;
      logger.warn('[DiscourseBackfill] capture failed', { issueId: issue.id, url });
    }

    await sleep(DELAY_MS);
  }

  logger.info('[DiscourseBackfill] done', { ok, skipped, failed, total: rows.length });
}

main().catch((e) => {
  logger.error('[DiscourseBackfill] fatal', { error: e.message, stack: e.stack });
  process.exit(1);
});

