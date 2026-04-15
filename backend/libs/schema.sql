-- SQLite 데이터베이스 스키마
-- Prisma 스키마에서 변환됨

-- 외래 키 제약 조건 활성화
PRAGMA foreign_keys = ON;

-- Report 테이블
CREATE TABLE IF NOT EXISTS Report (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  date TEXT NOT NULL,
  fileType TEXT NOT NULL,
  fileName TEXT,
  reportType TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  uploadedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agentId) REFERENCES Agent(id)
);

CREATE INDEX IF NOT EXISTS idx_report_agentId ON Report(agentId);
CREATE INDEX IF NOT EXISTS idx_report_date ON Report(date);
CREATE INDEX IF NOT EXISTS idx_report_reportType ON Report(reportType);

-- ReportItemVOC 테이블
CREATE TABLE IF NOT EXISTS ReportItemVOC (
  id TEXT PRIMARY KEY,
  reportId TEXT NOT NULL,
  date TEXT NOT NULL,
  source TEXT,
  category TEXT,
  subcategory TEXT,
  type TEXT,
  sentiment TEXT,
  importance TEXT,
  content TEXT,
  judgment TEXT,
  working TEXT,
  remarks TEXT,
  link TEXT,
  extraField14 TEXT,
  extraField15 TEXT,
  extraField16 TEXT,
  extraField17 TEXT,
  extraField18 TEXT,
  extraField19 TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reportId) REFERENCES Report(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reportitemvoc_reportId ON ReportItemVOC(reportId);
CREATE INDEX IF NOT EXISTS idx_reportitemvoc_date ON ReportItemVOC(date);

-- CategoryGroup 테이블
CREATE TABLE IF NOT EXISTS CategoryGroup (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  color TEXT,
  description TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  projectId INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
  UNIQUE(projectId, code)
);

CREATE INDEX IF NOT EXISTS idx_categorygroup_code ON CategoryGroup(code);
CREATE INDEX IF NOT EXISTS idx_categorygroup_isActive ON CategoryGroup(isActive);
CREATE INDEX IF NOT EXISTS idx_categorygroup_projectId ON CategoryGroup(projectId);

-- SystemCode 테이블
CREATE TABLE IF NOT EXISTS SystemCode (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  displayOrder INTEGER,
  isActive INTEGER NOT NULL DEFAULT 1,
  metadata TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(type, code)
);

CREATE INDEX IF NOT EXISTS idx_systemcode_type ON SystemCode(type);
CREATE INDEX IF NOT EXISTS idx_systemcode_isActive ON SystemCode(isActive);
CREATE INDEX IF NOT EXISTS idx_systemcode_displayOrder ON SystemCode(displayOrder);

-- Category 테이블
CREATE TABLE IF NOT EXISTS Category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  groupId INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  importance TEXT NOT NULL DEFAULT 'MEDIUM',
  description TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (groupId) REFERENCES CategoryGroup(id) ON DELETE CASCADE,
  UNIQUE(groupId, code)
);

CREATE INDEX IF NOT EXISTS idx_category_groupId ON Category(groupId);
CREATE INDEX IF NOT EXISTS idx_category_code ON Category(code);
CREATE INDEX IF NOT EXISTS idx_category_isActive ON Category(isActive);

-- ReportItemIssue 테이블
CREATE TABLE IF NOT EXISTS ReportItemIssue (
  id TEXT PRIMARY KEY,
  reportId TEXT NOT NULL,
  projectId INTEGER,
  channelId INTEGER,
  assignedAgentId TEXT,
  date TEXT NOT NULL,
  legacyCategory TEXT,
  detail TEXT,
  testResult TEXT,
  summary TEXT,
  link TEXT,
  time TEXT,
  severity INTEGER,
  source TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'OPEN',
  sentiment TEXT NOT NULL DEFAULT 'neu',
  importance TEXT NOT NULL DEFAULT 'MEDIUM',
  categoryGroupId INTEGER,
  categoryId INTEGER,
  otherGameTitle TEXT,
  sourceUrl TEXT,
  externalPostId TEXT,
  externalSource TEXT,
  monitoredUrlId INTEGER,
  monitoredBoardId INTEGER,
  screenshotPath TEXT,
  postImagePaths TEXT,
  hasImages INTEGER NOT NULL DEFAULT 0,
  requiresLogin INTEGER NOT NULL DEFAULT 0,
  discourseViews INTEGER,
  discourseLikeCount INTEGER,
  discourseReplyCount INTEGER,
  slackMessageTs TEXT UNIQUE,
  slackChannelId TEXT,
  aiClassificationReason TEXT,
  aiClassificationMethod TEXT,
  trend TEXT,
  commentCount INTEGER NOT NULL DEFAULT 0,
  scrapedComments TEXT,
  isHotTopic INTEGER NOT NULL DEFAULT 0,
  checkedAt DATETIME,
  checkedBy TEXT,
  processedAt DATETIME,
  processedBy TEXT,
  slaBreachedAt DATETIME,
  excludedFromReport INTEGER NOT NULL DEFAULT 0,
  excludedAt DATETIME,
  excludedBy TEXT,
  sourceCreatedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reportId) REFERENCES Report(id) ON DELETE CASCADE,
  FOREIGN KEY (projectId) REFERENCES Project(id),
  FOREIGN KEY (channelId) REFERENCES Channel(id),
  FOREIGN KEY (assignedAgentId) REFERENCES Agent(id),
  FOREIGN KEY (categoryGroupId) REFERENCES CategoryGroup(id),
  FOREIGN KEY (categoryId) REFERENCES Category(id),
  FOREIGN KEY (monitoredUrlId) REFERENCES MonitoredUrl(id),
  FOREIGN KEY (monitoredBoardId) REFERENCES MonitoredBoard(id)
);

CREATE INDEX IF NOT EXISTS idx_reportitemissue_reportId ON ReportItemIssue(reportId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_date ON ReportItemIssue(date);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_status ON ReportItemIssue(status);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_checkedAt ON ReportItemIssue(checkedAt);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_processedAt ON ReportItemIssue(processedAt);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_projectId ON ReportItemIssue(projectId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_channelId ON ReportItemIssue(channelId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_assignedAgentId ON ReportItemIssue(assignedAgentId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_slaBreachedAt ON ReportItemIssue(slaBreachedAt);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_categoryGroupId ON ReportItemIssue(categoryGroupId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_categoryId ON ReportItemIssue(categoryId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_importance ON ReportItemIssue(importance);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_externalPostId ON ReportItemIssue(externalPostId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_sourceUrl ON ReportItemIssue(sourceUrl);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_monitoredUrlId ON ReportItemIssue(monitoredUrlId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_monitoredBoardId ON ReportItemIssue(monitoredBoardId);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_slackMessageTs ON ReportItemIssue(slackMessageTs);
CREATE INDEX IF NOT EXISTS idx_reportitemissue_slackChannelId ON ReportItemIssue(slackChannelId);

-- MonitoredUrl 테이블
CREATE TABLE IF NOT EXISTS MonitoredUrl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  cafeGame TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  interval INTEGER NOT NULL DEFAULT 60,
  lastRunAt DATETIME,
  projectId INTEGER,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projectId) REFERENCES Project(id)
);

CREATE INDEX IF NOT EXISTS idx_monitoredurl_enabled ON MonitoredUrl(enabled);
CREATE INDEX IF NOT EXISTS idx_monitoredurl_cafeGame ON MonitoredUrl(cafeGame);
CREATE INDEX IF NOT EXISTS idx_monitoredurl_projectId ON MonitoredUrl(projectId);

-- MonitoredBoard 테이블
CREATE TABLE IF NOT EXISTS MonitoredBoard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cafeGame TEXT NOT NULL,
  listUrl TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 1,
  interval INTEGER NOT NULL DEFAULT 300,
  checkInterval INTEGER NOT NULL DEFAULT 300,
  lastArticleId TEXT,
  lastScanAt DATETIME,
  projectId INTEGER,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projectId) REFERENCES Project(id)
);

CREATE INDEX IF NOT EXISTS idx_monitoredboard_enabled ON MonitoredBoard(enabled);
CREATE INDEX IF NOT EXISTS idx_monitoredboard_isActive ON MonitoredBoard(isActive);
CREATE INDEX IF NOT EXISTS idx_monitoredboard_cafeGame ON MonitoredBoard(cafeGame);
CREATE INDEX IF NOT EXISTS idx_monitoredboard_projectId ON MonitoredBoard(projectId);

-- 목록(Playwright) 기준 일별 게시글 수 스냅샷 (통계 재조회 시 DB 우선)
CREATE TABLE IF NOT EXISTS BoardListDailySnapshot (
  monitoredBoardId INTEGER NOT NULL,
  dateKst TEXT NOT NULL,
  postCount INTEGER NOT NULL DEFAULT 0,
  scanTotalRows INTEGER,
  maxPagesUsed INTEGER,
  computedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (monitoredBoardId, dateKst),
  FOREIGN KEY (monitoredBoardId) REFERENCES MonitoredBoard(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_boardlistsnapshot_date ON BoardListDailySnapshot(dateKst);
CREATE INDEX IF NOT EXISTS idx_boardlistsnapshot_computed ON BoardListDailySnapshot(computedAt);

-- IssueComment 테이블
CREATE TABLE IF NOT EXISTS IssueComment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issueId TEXT NOT NULL,
  authorId TEXT,
  body TEXT NOT NULL,
  externalCommentId TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issueId) REFERENCES ReportItemIssue(id) ON DELETE CASCADE,
  FOREIGN KEY (authorId) REFERENCES Agent(id)
);

CREATE INDEX IF NOT EXISTS idx_issuecomment_issueId ON IssueComment(issueId);
CREATE INDEX IF NOT EXISTS idx_issuecomment_authorId ON IssueComment(authorId);
CREATE INDEX IF NOT EXISTS idx_issuecomment_externalCommentId ON IssueComment(externalCommentId);

-- 이슈 댓글 주기 감시 (네이버 카페 원문, 관리 모드)
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

-- ReportItemData 테이블
CREATE TABLE IF NOT EXISTS ReportItemData (
  id TEXT PRIMARY KEY,
  reportId TEXT NOT NULL,
  category TEXT,
  date TEXT NOT NULL,
  author TEXT,
  communityIssue TEXT,
  share TEXT,
  request TEXT,
  remarks TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reportId) REFERENCES Report(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reportitemdata_reportId ON ReportItemData(reportId);
CREATE INDEX IF NOT EXISTS idx_reportitemdata_date ON ReportItemData(date);

-- WeeklyReport 테이블
CREATE TABLE IF NOT EXISTS WeeklyReport (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  reportType TEXT NOT NULL,
  period TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  dailyReportCount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  charts TEXT,
  majorIssueStats TEXT,
  sharedIssues TEXT,
  trends TEXT,
  vocData TEXT,
  dataSheet TEXT,
  dailyReports TEXT
);

CREATE INDEX IF NOT EXISTS idx_weeklyreport_agentId ON WeeklyReport(agentId);
CREATE INDEX IF NOT EXISTS idx_weeklyreport_reportType ON WeeklyReport(reportType);
CREATE INDEX IF NOT EXISTS idx_weeklyreport_startDate ON WeeklyReport(startDate);

-- WeeklyStat 테이블
CREATE TABLE IF NOT EXISTS WeeklyStat (
  id TEXT PRIMARY KEY,
  weeklyReportId TEXT NOT NULL UNIQUE,
  totalCollected INTEGER,
  vocCount INTEGER,
  issueCount INTEGER,
  dataCount INTEGER,
  totalIssues INTEGER,
  totalProcessed INTEGER,
  processingRate TEXT,
  averageDailyIssues TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (weeklyReportId) REFERENCES WeeklyReport(id) ON DELETE CASCADE
);

-- User 테이블
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'AGENT',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Project 테이블
CREATE TABLE IF NOT EXISTS Project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  severityRules TEXT,
  reportConfig TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Channel 테이블
CREATE TABLE IF NOT EXISTS Channel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  type TEXT NOT NULL,
  externalId TEXT NOT NULL,
  name TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projectId) REFERENCES Project(id)
);

-- ClassificationRule 테이블
CREATE TABLE IF NOT EXISTS ClassificationRule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_classificationrule_projectId ON ClassificationRule(projectId);
CREATE INDEX IF NOT EXISTS idx_classificationrule_isActive ON ClassificationRule(isActive);

-- Agent 테이블
CREATE TABLE IF NOT EXISTS Agent (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  handling INTEGER NOT NULL DEFAULT 0,
  todayResolved INTEGER NOT NULL DEFAULT 0,
  avgHandleSec INTEGER NOT NULL DEFAULT 0,
  channelFocus TEXT NOT NULL DEFAULT '[]',
  email TEXT,
  phone TEXT,
  department TEXT,
  position TEXT,
  slackId TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  projectId INTEGER,
  userId INTEGER,
  FOREIGN KEY (projectId) REFERENCES Project(id),
  FOREIGN KEY (userId) REFERENCES User(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_status ON Agent(status);
CREATE INDEX IF NOT EXISTS idx_agent_isActive ON Agent(isActive);
CREATE INDEX IF NOT EXISTS idx_agent_projectId ON Agent(projectId);
CREATE INDEX IF NOT EXISTS idx_agent_userId ON Agent(userId);

-- AgentSchedule 테이블
CREATE TABLE IF NOT EXISTS AgentSchedule (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  scheduleType TEXT NOT NULL DEFAULT 'weekly',
  dayOfWeek INTEGER,
  specificDate TEXT,
  startTime TEXT NOT NULL,
  endTime TEXT NOT NULL,
  workType TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agentId) REFERENCES Agent(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agentschedule_agentId ON AgentSchedule(agentId);
CREATE INDEX IF NOT EXISTS idx_agentschedule_scheduleType ON AgentSchedule(scheduleType);
CREATE INDEX IF NOT EXISTS idx_agentschedule_dayOfWeek ON AgentSchedule(dayOfWeek);
CREATE INDEX IF NOT EXISTS idx_agentschedule_specificDate ON AgentSchedule(specificDate);

-- SlaPolicy 테이블
CREATE TABLE IF NOT EXISTS SlaPolicy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId INTEGER NOT NULL,
  severity TEXT NOT NULL,
  responseSec INTEGER NOT NULL,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slapolicy_projectId ON SlaPolicy(projectId);
CREATE INDEX IF NOT EXISTS idx_slapolicy_isActive ON SlaPolicy(isActive);
CREATE INDEX IF NOT EXISTS idx_slapolicy_severity ON SlaPolicy(severity);

-- AuditLog 테이블
CREATE TABLE IF NOT EXISTS AuditLog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER,
  action TEXT NOT NULL,
  meta TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (userId) REFERENCES User(id)
);

CREATE INDEX IF NOT EXISTS idx_auditlog_userId ON AuditLog(userId);
CREATE INDEX IF NOT EXISTS idx_auditlog_action ON AuditLog(action);
CREATE INDEX IF NOT EXISTS idx_auditlog_createdAt ON AuditLog(createdAt);

-- MonitoringKeyword 테이블
CREATE TABLE IF NOT EXISTS MonitoringKeyword (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  word TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monitoringkeyword_type ON MonitoringKeyword(type);
CREATE INDEX IF NOT EXISTS idx_monitoringkeyword_enabled ON MonitoringKeyword(enabled);
CREATE INDEX IF NOT EXISTS idx_monitoringkeyword_word ON MonitoringKeyword(word);

-- MonitoringConfig 테이블
CREATE TABLE IF NOT EXISTS MonitoringConfig (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RawLog 테이블
CREATE TABLE IF NOT EXISTS RawLog (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT,
  timestamp DATETIME NOT NULL,
  isProcessed INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rawlog_source ON RawLog(source);
CREATE INDEX IF NOT EXISTS idx_rawlog_isProcessed ON RawLog(isProcessed);
CREATE INDEX IF NOT EXISTS idx_rawlog_timestamp ON RawLog(timestamp);
CREATE INDEX IF NOT EXISTS idx_rawlog_createdAt ON RawLog(createdAt);

-- CustomerFeedbackNotice 테이블
CREATE TABLE IF NOT EXISTS CustomerFeedbackNotice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  gameName TEXT NOT NULL,
  managerName TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  noticeDate DATETIME NOT NULL,
  endedAt DATETIME,
  url TEXT,
  screenshotPath TEXT,
  slackChannelId TEXT,
  slackTeamId TEXT,
  createdBy TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customerfeedbacknotice_isActive ON CustomerFeedbackNotice(isActive);
CREATE INDEX IF NOT EXISTS idx_customerfeedbacknotice_noticeDate ON CustomerFeedbackNotice(noticeDate);
CREATE INDEX IF NOT EXISTS idx_customerfeedbacknotice_createdAt ON CustomerFeedbackNotice(createdAt);

-- CustomerFeedbackNoticeRead 테이블
CREATE TABLE IF NOT EXISTS CustomerFeedbackNoticeRead (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  noticeId INTEGER NOT NULL,
  agentId TEXT,
  readAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (noticeId) REFERENCES CustomerFeedbackNotice(id) ON DELETE CASCADE,
  FOREIGN KEY (agentId) REFERENCES Agent(id),
  UNIQUE(noticeId, agentId)
);

CREATE INDEX IF NOT EXISTS idx_customerfeedbacknoticeread_noticeId ON CustomerFeedbackNoticeRead(noticeId);
CREATE INDEX IF NOT EXISTS idx_customerfeedbacknoticeread_agentId ON CustomerFeedbackNoticeRead(agentId);
CREATE INDEX IF NOT EXISTS idx_customerfeedbacknoticeread_readAt ON CustomerFeedbackNoticeRead(readAt);

-- IssueShareLog 테이블
CREATE TABLE IF NOT EXISTS IssueShareLog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issueId TEXT NOT NULL,
  agentId TEXT,
  target TEXT NOT NULL,
  sentAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL,
  messageSnapshot TEXT,
  errorMessage TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issueId) REFERENCES ReportItemIssue(id) ON DELETE CASCADE,
  FOREIGN KEY (agentId) REFERENCES Agent(id)
);

CREATE INDEX IF NOT EXISTS idx_issuesharelog_issueId ON IssueShareLog(issueId);
CREATE INDEX IF NOT EXISTS idx_issuesharelog_agentId ON IssueShareLog(agentId);
CREATE INDEX IF NOT EXISTS idx_issuesharelog_sentAt ON IssueShareLog(sentAt);
CREATE INDEX IF NOT EXISTS idx_issuesharelog_status ON IssueShareLog(status);

-- AIClassificationLog 테이블
CREATE TABLE IF NOT EXISTS AIClassificationLog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issueId TEXT NOT NULL,
  userId INTEGER,
  agentId TEXT,
  originalData TEXT NOT NULL,
  aiPrediction TEXT NOT NULL,
  userCorrection TEXT NOT NULL,
  changedFields TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (issueId) REFERENCES ReportItemIssue(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES User(id),
  FOREIGN KEY (agentId) REFERENCES Agent(id)
);

CREATE INDEX IF NOT EXISTS idx_aiclassificationlog_issueId ON AIClassificationLog(issueId);
CREATE INDEX IF NOT EXISTS idx_aiclassificationlog_userId ON AIClassificationLog(userId);
CREATE INDEX IF NOT EXISTS idx_aiclassificationlog_agentId ON AIClassificationLog(agentId);
CREATE INDEX IF NOT EXISTS idx_aiclassificationlog_createdAt ON AIClassificationLog(createdAt);

-- WorkNotification 테이블 (업무 알림 관리)
CREATE TABLE IF NOT EXISTS WorkNotification (
  id TEXT PRIMARY KEY,
  workName TEXT NOT NULL,              -- 업무명
  notificationDate TEXT NOT NULL,       -- 알림 날짜 (YYYY-MM-DD)
  notificationTime TEXT NOT NULL,       -- 알림 시간 (HH:mm)
  lineChannelId TEXT NOT NULL,          -- Line 채널 ID (Group ID 또는 User ID)
  message TEXT,                         -- 추가 메시지 (선택)
  isActive INTEGER NOT NULL DEFAULT 1,   -- 활성화 여부
  sent INTEGER NOT NULL DEFAULT 0,      -- 전송 완료 여부
  sentAt DATETIME,                       -- 전송 완료 시간
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);CREATE INDEX IF NOT EXISTS idx_worknotification_date ON WorkNotification(notificationDate);
CREATE INDEX IF NOT EXISTS idx_worknotification_time ON WorkNotification(notificationTime);
CREATE INDEX IF NOT EXISTS idx_worknotification_active ON WorkNotification(isActive);
CREATE INDEX IF NOT EXISTS idx_worknotification_sent ON WorkNotification(sent);
CREATE INDEX IF NOT EXISTS idx_worknotification_date_time ON WorkNotification(notificationDate, notificationTime);