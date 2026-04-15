/**
 * 이슈 댓글 주기 감시 워커 (별도 프로세스)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { chromium } = require('playwright');
const logger = require('../../utils/logger');
const { queryOne } = require('../../libs/db');
const issueCommentWatchService = require('../../services/issueCommentWatch.service');
const { refetchNaverCafeIssueDetail } = require('./lib/naverCafeIssueDetailRefetch');

const TICK_MS = parseInt(process.env.ISSUE_COMMENT_WATCH_TICK_MS || '30000', 10);
const BATCH = parseInt(process.env.ISSUE_COMMENT_WATCH_BATCH || '3', 10);
const MIN_GAP_MS = parseInt(process.env.ISSUE_COMMENT_WATCH_MIN_GAP_MS || '5000', 10);
const MAX_GAP_MS = parseInt(process.env.ISSUE_COMMENT_WATCH_MAX_GAP_MS || '25000', 10);
const BROWSER_HEADLESS = process.env.BROWSER_HEADLESS !== 'false';
const INTERNAL_BASE =
  process.env.ISSUE_WATCH_INTERNAL_BASE_URL || `http://127.0.0.1:${process.env.PORT || 9080}`;

let browser = null;
let tickRunning = false;

function randomSleepMs() {
  return MIN_GAP_MS + Math.floor(Math.random() * Math.max(1, MAX_GAP_MS - MIN_GAP_MS));
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function notifyMainServer(issueId) {
  const token = process.env.ISSUE_WATCH_INTERNAL_TOKEN;
  if (!token || String(token).trim() === '') {
    logger.warn('[IssueCommentWatchWorker] ISSUE_WATCH_INTERNAL_TOKEN not set, skipping broadcast callback');
    return;
  }
  const url = `${INTERNAL_BASE.replace(/\/$/, '')}/api/internal/issue-comment-refreshed`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': token
      },
      body: JSON.stringify({ issueId })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('[IssueCommentWatchWorker] Internal callback failed', { status: res.status, text: text.slice(0, 200) });
    }
  } catch (e) {
    logger.error('[IssueCommentWatchWorker] Internal callback error', { error: e.message });
  }
}

async function processOneRow(row) {
  const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [row.issueId]);
  if (!issue) {
    issueCommentWatchService.setWatchError(row.issueId, 'Issue row missing');
    issueCommentWatchService.scheduleBackoff(row.issueId, 2);
    return;
  }

  const url = issueCommentWatchService.getIssueNaverUrl(issue);
  if (!url) {
    issueCommentWatchService.setWatchError(row.issueId, 'Not a Naver Cafe URL');
    issueCommentWatchService.scheduleBackoff(row.issueId, 1);
    return;
  }

  const result = await refetchNaverCafeIssueDetail(browser, url, {});

  if (!result.ok) {
    issueCommentWatchService.setWatchError(row.issueId, result.error || 'Refetch failed');
    issueCommentWatchService.scheduleBackoff(row.issueId, 3);
    return;
  }

  issueCommentWatchService.updateIssueComments(row.issueId, {
    commentCount: result.commentCount ?? 0,
    scrapedComments: result.scrapedComments ?? null
  });

  issueCommentWatchService.scheduleNextRun(row.issueId, row.intervalSeconds, null);
  await notifyMainServer(row.issueId);
}

async function runTick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const rows = issueCommentWatchService.getDueWatches(BATCH);
    for (const row of rows) {
      await processOneRow(row);
      await sleep(randomSleepMs());
    }
  } catch (e) {
    logger.error('[IssueCommentWatchWorker] Tick error', { error: e.message, stack: e.stack });
  } finally {
    tickRunning = false;
  }
}

async function main() {
  logger.info('[IssueCommentWatchWorker] Starting', {
    tickMs: TICK_MS,
    batch: BATCH,
    headless: BROWSER_HEADLESS
  });

  browser = await chromium.launch({ headless: BROWSER_HEADLESS });

  setInterval(() => {
    runTick().catch((e) => logger.error('[IssueCommentWatchWorker] runTick', { error: e.message }));
  }, TICK_MS);

  runTick().catch((e) => logger.error('[IssueCommentWatchWorker] initial runTick', { error: e.message }));
}

process.on('SIGINT', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});

main().catch((e) => {
  logger.error('[IssueCommentWatchWorker] Fatal', { error: e.message, stack: e.stack });
  process.exit(1);
});
