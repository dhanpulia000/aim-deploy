-- AIPromptConfig 테이블 추가
-- AI 프롬프트 관리 기능을 위한 테이블

CREATE TABLE IF NOT EXISTS AIPromptConfig (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL,
  description TEXT,
  systemPrompt TEXT NOT NULL,
  userPromptTemplate TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_aipromptconfig_name ON AIPromptConfig(name);
CREATE INDEX IF NOT EXISTS idx_aipromptconfig_isActive ON AIPromptConfig(isActive);

