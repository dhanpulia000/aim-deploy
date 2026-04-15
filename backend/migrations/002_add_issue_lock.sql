-- Migration: Add IssueLock table for concurrent access control
-- Date: 2025-12-11

CREATE TABLE IF NOT EXISTS IssueLock (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  issueId TEXT NOT NULL,
  userId TEXT NOT NULL,
  userName TEXT NOT NULL,
  lockedAt TEXT NOT NULL DEFAULT (datetime('now')),
  expiresAt TEXT NOT NULL, -- Auto-expire after 5 minutes of inactivity
  lastActivityAt TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (issueId) REFERENCES Issue(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);

-- Index for fast lookup by issueId
CREATE INDEX IF NOT EXISTS idx_issuelock_issueId ON IssueLock(issueId);

-- Index for finding expired locks
CREATE INDEX IF NOT EXISTS idx_issuelock_expiresAt ON IssueLock(expiresAt);

-- Only one active lock per issue (enforced by unique constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_issuelock_unique_issue ON IssueLock(issueId);


