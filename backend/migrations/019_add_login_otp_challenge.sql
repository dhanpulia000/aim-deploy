CREATE TABLE IF NOT EXISTS LoginOtpChallenge (
  id TEXT PRIMARY KEY NOT NULL,
  userId INTEGER NOT NULL,
  codeHash TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  attemptCount INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  lastResendAt TEXT,
  FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_loginotpchallenge_userId ON LoginOtpChallenge(userId);

CREATE INDEX IF NOT EXISTS idx_loginotpchallenge_expiresAt ON LoginOtpChallenge(expiresAt);
