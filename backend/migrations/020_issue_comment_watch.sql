CREATE TABLE IF NOT EXISTS IssueCommentWatch (
  issueId TEXT PRIMARY KEY NOT NULL,
  intervalSeconds INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  nextRunAt TEXT NOT NULL,
  lastRunAt TEXT,
  lastError TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (issueId) REFERENCES ReportItemIssue(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issuecommentwatch_due ON IssueCommentWatch(enabled, nextRunAt);
