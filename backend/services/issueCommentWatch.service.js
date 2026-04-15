/**
 * 이슈 댓글 주기 감시 (네이버 카페 원문만)
 */

const { query, queryOne, execute } = require('../libs/db');
const logger = require('../utils/logger');

const MIN_INTERVAL_SEC = parseInt(process.env.ISSUE_COMMENT_WATCH_MIN_INTERVAL_SEC || '300', 10);
const MAX_INTERVAL_SEC = parseInt(process.env.ISSUE_COMMENT_WATCH_MAX_INTERVAL_SEC || String(24 * 3600), 10);
const BACKOFF_BASE_SEC = parseInt(process.env.ISSUE_COMMENT_WATCH_BACKOFF_BASE_SEC || '300', 10);
const BACKOFF_MAX_SEC = parseInt(process.env.ISSUE_COMMENT_WATCH_BACKOFF_MAX_SEC || String(24 * 3600), 10);

function clampIntervalSeconds(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n)) return MIN_INTERVAL_SEC;
  return Math.max(MIN_INTERVAL_SEC, Math.min(MAX_INTERVAL_SEC, Math.floor(n)));
}

function clampBackoffSeconds(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n)) return BACKOFF_BASE_SEC;
  return Math.max(BACKOFF_BASE_SEC, Math.min(BACKOFF_MAX_SEC, Math.floor(n)));
}

function isNaverCafeUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url.trim());
    return u.hostname === 'cafe.naver.com' || u.hostname.endsWith('.cafe.naver.com');
  } catch {
    return false;
  }
}

function getIssueNaverUrl(issue) {
  if (!issue) return null;
  const link = issue.sourceUrl || issue.link;
  return link && isNaverCafeUrl(link) ? link.trim() : null;
}

function rowToWatchDto(row) {
  if (!row) return null;
  return {
    enabled: Boolean(row.enabled),
    intervalSeconds: row.intervalSeconds,
    intervalMinutes: Math.round(row.intervalSeconds / 60),
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function getWatchByIssueId(issueId) {
  return queryOne('SELECT * FROM IssueCommentWatch WHERE issueId = ?', [issueId]);
}

/**
 * @param {string} issueId
 * @param {{ enabled: boolean, intervalMinutes?: number }} body
 * @param {number|undefined} projectId
 */
function upsertCommentWatch(issueId, body, projectId) {
  const issue = queryOne('SELECT * FROM ReportItemIssue WHERE id = ?', [issueId]);
  if (!issue) {
    const err = new Error('Issue not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (projectId !== undefined && projectId !== null && issue.projectId != null && issue.projectId !== projectId) {
    const err = new Error('Issue does not belong to the selected project');
    err.code = 'FORBIDDEN_PROJECT';
    throw err;
  }
  if (!getIssueNaverUrl(issue)) {
    const err = new Error('Naver Cafe URL required (sourceUrl or link)');
    err.code = 'invalid_url';
    throw err;
  }

  const enabled = Boolean(body.enabled);
  const intervalMinutes = body.intervalMinutes != null ? Number(body.intervalMinutes) : 30;
  const intervalSeconds = clampIntervalSeconds(
    Number.isFinite(intervalMinutes) ? intervalMinutes * 60 : 30 * 60
  );
  const now = new Date().toISOString();

  if (!enabled) {
    const existing = getWatchByIssueId(issueId);
    if (!existing) {
      return { watch: null, issueId };
    }
    execute(
      'UPDATE IssueCommentWatch SET enabled = 0, updatedAt = ?, lastError = NULL WHERE issueId = ?',
      [now, issueId]
    );
    return { watch: rowToWatchDto(getWatchByIssueId(issueId)), issueId };
  }

  const nextRunAt = now;
  const existing = getWatchByIssueId(issueId);
  if (existing) {
    execute(
      `UPDATE IssueCommentWatch SET enabled = 1, intervalSeconds = ?, nextRunAt = ?, lastError = NULL, updatedAt = ?
       WHERE issueId = ?`,
      [intervalSeconds, nextRunAt, now, issueId]
    );
  } else {
    execute(
      `INSERT INTO IssueCommentWatch (issueId, intervalSeconds, enabled, nextRunAt, createdAt, updatedAt)
       VALUES (?, ?, 1, ?, ?, ?)`,
      [issueId, intervalSeconds, nextRunAt, now, now]
    );
  }
  return { watch: rowToWatchDto(getWatchByIssueId(issueId)), issueId };
}

function getDueWatches(limit = 3) {
  const now = new Date().toISOString();
  return query(
    `SELECT w.* FROM IssueCommentWatch w
     WHERE w.enabled = 1 AND w.nextRunAt <= ?
     ORDER BY w.nextRunAt ASC
     LIMIT ?`,
    [now, limit]
  );
}

function scheduleNextRun(issueId, intervalSeconds, lastError = null) {
  const now = Date.now();
  const next = new Date(now + intervalSeconds * 1000).toISOString();
  const updatedAt = new Date(now).toISOString();
  execute(
    `UPDATE IssueCommentWatch SET nextRunAt = ?, lastRunAt = ?, lastError = ?, updatedAt = ? WHERE issueId = ?`,
    [next, new Date(now).toISOString(), lastError, updatedAt, issueId]
  );
}

function scheduleBackoff(issueId, attemptHint = 1) {
  const row = getWatchByIssueId(issueId);
  const intervalSec = row ? row.intervalSeconds : MIN_INTERVAL_SEC;
  const backoff = clampBackoffSeconds(BACKOFF_BASE_SEC * Math.pow(2, Math.max(0, attemptHint - 1)));
  const next = new Date(Date.now() + backoff * 1000).toISOString();
  const updatedAt = new Date().toISOString();
  execute(
    `UPDATE IssueCommentWatch SET nextRunAt = ?, updatedAt = ? WHERE issueId = ?`,
    [next, updatedAt, issueId]
  );
  logger.warn('[IssueCommentWatch] Scheduled backoff', { issueId, backoffSec: backoff, nextRunAt: next });
}

function setWatchError(issueId, message) {
  const now = new Date().toISOString();
  execute(
    'UPDATE IssueCommentWatch SET lastError = ?, updatedAt = ? WHERE issueId = ?',
    [message || null, now, issueId]
  );
}

function updateIssueComments(issueId, { commentCount, scrapedComments }) {
  const now = new Date().toISOString();
  execute(
    'UPDATE ReportItemIssue SET commentCount = ?, scrapedComments = ?, updatedAt = ? WHERE id = ?',
    [commentCount ?? 0, scrapedComments ?? null, now, issueId]
  );
}

function getCommentWatches({ enabledOnly = true, projectId = undefined, limit = 50, offset = 0 } = {}) {
  const params = [];
  const whereParts = ['1=1'];

  if (enabledOnly) {
    whereParts.push('w.enabled = 1');
  }
  if (projectId !== undefined && projectId !== null) {
    whereParts.push('i.projectId = ?');
    params.push(projectId);
  }

  const whereSql = whereParts.join(' AND ');

  const totalResult = queryOne(
    `SELECT COUNT(*) as total
     FROM IssueCommentWatch w
     JOIN ReportItemIssue i ON i.id = w.issueId
     WHERE ${whereSql}`,
    params
  );

  const watches = query(
    `SELECT
       w.issueId,
       w.enabled,
       w.intervalSeconds,
       w.nextRunAt,
       w.lastRunAt,
       w.lastError,
       w.updatedAt,
       i.projectId,
       i.summary,
       i.sourceUrl,
       i.link,
       i.commentCount,
       i.scrapedComments
     FROM IssueCommentWatch w
     JOIN ReportItemIssue i ON i.id = w.issueId
     WHERE ${whereSql}
     ORDER BY w.updatedAt DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    total: totalResult?.total ?? 0,
    watches: watches.map((w) => ({
      issueId: w.issueId,
      enabled: Boolean(w.enabled),
      intervalSeconds: w.intervalSeconds,
      intervalMinutes: Math.round((w.intervalSeconds ?? 0) / 60),
      nextRunAt: w.nextRunAt,
      lastRunAt: w.lastRunAt,
      lastError: w.lastError,
      updatedAt: w.updatedAt,
      projectId: w.projectId ?? null,
      title: w.summary || w.link || w.sourceUrl || '',
      sourceUrl: w.sourceUrl || w.link || null,
      commentCount: w.commentCount ?? 0,
      scrapedComments: w.scrapedComments ?? null
    }))
  };
}

module.exports = {
  MIN_INTERVAL_SEC,
  MAX_INTERVAL_SEC,
  isNaverCafeUrl,
  getIssueNaverUrl,
  getWatchByIssueId,
  rowToWatchDto,
  upsertCommentWatch,
  getDueWatches,
  getCommentWatches,
  scheduleNextRun,
  scheduleBackoff,
  setWatchError,
  updateIssueComments
};
