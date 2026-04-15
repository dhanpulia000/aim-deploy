-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileName" TEXT,
    "reportType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportItemVOC" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT,
    "category" TEXT,
    "subcategory" TEXT,
    "type" TEXT,
    "sentiment" TEXT,
    "importance" TEXT,
    "content" TEXT,
    "judgment" TEXT,
    "working" TEXT,
    "remarks" TEXT,
    "link" TEXT,
    "extraField14" TEXT,
    "extraField15" TEXT,
    "extraField16" TEXT,
    "extraField17" TEXT,
    "extraField18" TEXT,
    "extraField19" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportItemVOC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "projectId" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemCode" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "displayOrder" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "importance" TEXT NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportItemIssue" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "projectId" INTEGER,
    "channelId" INTEGER,
    "assignedAgentId" TEXT,
    "date" TEXT NOT NULL,
    "legacyCategory" TEXT,
    "detail" TEXT,
    "testResult" TEXT,
    "summary" TEXT,
    "link" TEXT,
    "time" TEXT,
    "severity" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "sentiment" TEXT NOT NULL DEFAULT 'neu',
    "importance" TEXT NOT NULL DEFAULT 'MEDIUM',
    "categoryGroupId" INTEGER,
    "categoryId" INTEGER,
    "otherGameTitle" TEXT,
    "sourceUrl" TEXT,
    "externalPostId" TEXT,
    "externalSource" TEXT,
    "monitoredUrlId" INTEGER,
    "monitoredBoardId" INTEGER,
    "screenshotPath" TEXT,
    "hasImages" BOOLEAN NOT NULL DEFAULT false,
    "requiresLogin" BOOLEAN NOT NULL DEFAULT false,
    "slackMessageTs" TEXT,
    "slackChannelId" TEXT,
    "aiClassificationReason" TEXT,
    "aiClassificationMethod" TEXT,
    "trend" TEXT,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "scrapedComments" TEXT,
    "isHotTopic" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" TIMESTAMP(3),
    "checkedBy" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "slaBreachedAt" TIMESTAMP(3),
    "excludedFromReport" BOOLEAN NOT NULL DEFAULT false,
    "excludedAt" TIMESTAMP(3),
    "excludedBy" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportItemIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoredUrl" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "cafeGame" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "interval" INTEGER NOT NULL DEFAULT 60,
    "lastRunAt" TIMESTAMP(3),
    "projectId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoredBoard" (
    "id" SERIAL NOT NULL,
    "cafeGame" TEXT NOT NULL,
    "listUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "interval" INTEGER NOT NULL DEFAULT 300,
    "checkInterval" INTEGER NOT NULL DEFAULT 300,
    "lastArticleId" TEXT,
    "lastScanAt" TIMESTAMP(3),
    "projectId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueComment" (
    "id" SERIAL NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportItemData" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "category" TEXT,
    "date" TEXT NOT NULL,
    "author" TEXT,
    "communityIssue" TEXT,
    "share" TEXT,
    "request" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportItemData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "dailyReportCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "charts" TEXT,
    "majorIssueStats" TEXT,
    "sharedIssues" TEXT,
    "trends" TEXT,
    "vocData" TEXT,
    "dataSheet" TEXT,
    "dailyReports" TEXT,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyStat" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "totalCollected" INTEGER,
    "vocCount" INTEGER,
    "issueCount" INTEGER,
    "dataCount" INTEGER,
    "totalIssues" INTEGER,
    "totalProcessed" INTEGER,
    "processingRate" TEXT,
    "averageDailyIssues" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginOtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "lastResendAt" TEXT,

    CONSTRAINT "LoginOtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "severityRules" TEXT,
    "reportConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationRule" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "handling" INTEGER NOT NULL DEFAULT 0,
    "todayResolved" INTEGER NOT NULL DEFAULT 0,
    "avgHandleSec" INTEGER NOT NULL DEFAULT 0,
    "channelFocus" TEXT NOT NULL DEFAULT '[]',
    "email" TEXT,
    "phone" TEXT,
    "department" TEXT,
    "position" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" INTEGER,
    "userId" INTEGER,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSchedule" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'weekly',
    "dayOfWeek" INTEGER,
    "specificDate" TEXT,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "workType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "responseSec" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringKeyword" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "RawLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "boardId" INTEGER,
    "articleId" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'NEW',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFeedbackNotice" (
    "id" SERIAL NOT NULL,
    "gameName" TEXT NOT NULL,
    "managerName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "noticeDate" TIMESTAMP(3) NOT NULL,
    "screenshotPath" TEXT,
    "slackChannelId" TEXT,
    "slackTeamId" TEXT,
    "url" TEXT,
    "createdBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerFeedbackNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFeedbackNoticeRead" (
    "id" SERIAL NOT NULL,
    "noticeId" INTEGER NOT NULL,
    "agentId" TEXT,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFeedbackNoticeRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueShareLog" (
    "id" SERIAL NOT NULL,
    "issueId" TEXT NOT NULL,
    "agentId" TEXT,
    "target" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "messageSnapshot" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueShareLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIClassificationLog" (
    "id" SERIAL NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" INTEGER,
    "agentId" TEXT,
    "originalData" TEXT NOT NULL,
    "aiPrediction" TEXT NOT NULL,
    "userCorrection" TEXT NOT NULL,
    "changedFields" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIClassificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeVideoCaptionCache" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "captionText" TEXT,
    "isBattlegroundsRelated" BOOLEAN NOT NULL DEFAULT false,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeVideoCaptionCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptConfig" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueLock" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepFloating" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'right',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepFloating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverRecord" (
    "id" SERIAL NOT NULL,
    "workDate" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandoverRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSentVideo" (
    "platform" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "sentAt" TEXT NOT NULL,

    CONSTRAINT "PartnerSentVideo_pkey" PRIMARY KEY ("platform","videoId")
);

-- CreateTable
CREATE TABLE "WorkChecklistItem" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "workType" TEXT NOT NULL DEFAULT '전체',
    "validFrom" TEXT,
    "validTo" TEXT,
    "monthsOfYear" TEXT,
    "daysOfWeek" TEXT,
    "url" TEXT,
    "showInPC" INTEGER NOT NULL DEFAULT 0,
    "showInMO" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkChecklistExecution" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "workDate" TEXT NOT NULL,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkChecklistExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkChecklistBanner" (
    "id" INTEGER NOT NULL,
    "content" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkChecklistBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkChecklistItemSortByType" (
    "workType" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkChecklistItemSortByType_pkey" PRIMARY KEY ("workType","itemId")
);

-- CreateTable
CREATE TABLE "WorkChecklistAssignee" (
    "workType" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkChecklistAssignee_pkey" PRIMARY KEY ("workType","userId")
);

-- CreateTable
CREATE TABLE "BoardListDailySnapshot" (
    "monitoredBoardId" INTEGER NOT NULL,
    "dateKst" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "scanTotalRows" INTEGER,
    "maxPagesUsed" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardListDailySnapshot_pkey" PRIMARY KEY ("monitoredBoardId","dateKst")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "lineChannelId" TEXT,
    "discordWebhookUrl" TEXT,
    "discordMention" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkNotification" (
    "id" TEXT NOT NULL,
    "workName" TEXT NOT NULL,
    "notificationDate" TEXT NOT NULL,
    "notificationTime" TEXT NOT NULL,
    "lineChannelId" TEXT NOT NULL,
    "message" TEXT,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "intervalMinutes" INTEGER,
    "windowStartTime" TEXT,
    "windowEndTime" TEXT,
    "lastSentAt" TEXT,
    "discordWebhookUrl" TEXT,
    "discordMention" TEXT,
    "calendarEventId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueCommentWatch" (
    "issueId" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" TEXT NOT NULL,
    "lastRunAt" TEXT,
    "lastError" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "IssueCommentWatch_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "LineChatTarget" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "name" TEXT,
    "displayName" TEXT,
    "lastSeenAt" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,

    CONSTRAINT "LineChatTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_agentId_idx" ON "Report"("agentId");

-- CreateIndex
CREATE INDEX "Report_date_idx" ON "Report"("date");

-- CreateIndex
CREATE INDEX "Report_reportType_idx" ON "Report"("reportType");

-- CreateIndex
CREATE INDEX "ReportItemVOC_reportId_idx" ON "ReportItemVOC"("reportId");

-- CreateIndex
CREATE INDEX "ReportItemVOC_date_idx" ON "ReportItemVOC"("date");

-- CreateIndex
CREATE INDEX "CategoryGroup_code_idx" ON "CategoryGroup"("code");

-- CreateIndex
CREATE INDEX "CategoryGroup_isActive_idx" ON "CategoryGroup"("isActive");

-- CreateIndex
CREATE INDEX "CategoryGroup_projectId_idx" ON "CategoryGroup"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryGroup_projectId_code_key" ON "CategoryGroup"("projectId", "code");

-- CreateIndex
CREATE INDEX "SystemCode_type_idx" ON "SystemCode"("type");

-- CreateIndex
CREATE INDEX "SystemCode_isActive_idx" ON "SystemCode"("isActive");

-- CreateIndex
CREATE INDEX "SystemCode_displayOrder_idx" ON "SystemCode"("displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SystemCode_type_code_key" ON "SystemCode"("type", "code");

-- CreateIndex
CREATE INDEX "Category_groupId_idx" ON "Category"("groupId");

-- CreateIndex
CREATE INDEX "Category_code_idx" ON "Category"("code");

-- CreateIndex
CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Category_groupId_code_key" ON "Category"("groupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ReportItemIssue_slackMessageTs_key" ON "ReportItemIssue"("slackMessageTs");

-- CreateIndex
CREATE INDEX "ReportItemIssue_reportId_idx" ON "ReportItemIssue"("reportId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_date_idx" ON "ReportItemIssue"("date");

-- CreateIndex
CREATE INDEX "ReportItemIssue_status_idx" ON "ReportItemIssue"("status");

-- CreateIndex
CREATE INDEX "ReportItemIssue_checkedAt_idx" ON "ReportItemIssue"("checkedAt");

-- CreateIndex
CREATE INDEX "ReportItemIssue_processedAt_idx" ON "ReportItemIssue"("processedAt");

-- CreateIndex
CREATE INDEX "ReportItemIssue_projectId_idx" ON "ReportItemIssue"("projectId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_channelId_idx" ON "ReportItemIssue"("channelId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_assignedAgentId_idx" ON "ReportItemIssue"("assignedAgentId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_slaBreachedAt_idx" ON "ReportItemIssue"("slaBreachedAt");

-- CreateIndex
CREATE INDEX "ReportItemIssue_categoryGroupId_idx" ON "ReportItemIssue"("categoryGroupId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_categoryId_idx" ON "ReportItemIssue"("categoryId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_importance_idx" ON "ReportItemIssue"("importance");

-- CreateIndex
CREATE INDEX "ReportItemIssue_externalPostId_idx" ON "ReportItemIssue"("externalPostId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_sourceUrl_idx" ON "ReportItemIssue"("sourceUrl");

-- CreateIndex
CREATE INDEX "ReportItemIssue_monitoredUrlId_idx" ON "ReportItemIssue"("monitoredUrlId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_monitoredBoardId_idx" ON "ReportItemIssue"("monitoredBoardId");

-- CreateIndex
CREATE INDEX "ReportItemIssue_slackMessageTs_idx" ON "ReportItemIssue"("slackMessageTs");

-- CreateIndex
CREATE INDEX "ReportItemIssue_slackChannelId_idx" ON "ReportItemIssue"("slackChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredUrl_url_key" ON "MonitoredUrl"("url");

-- CreateIndex
CREATE INDEX "MonitoredUrl_enabled_idx" ON "MonitoredUrl"("enabled");

-- CreateIndex
CREATE INDEX "MonitoredUrl_cafeGame_idx" ON "MonitoredUrl"("cafeGame");

-- CreateIndex
CREATE INDEX "MonitoredUrl_projectId_idx" ON "MonitoredUrl"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredBoard_listUrl_key" ON "MonitoredBoard"("listUrl");

-- CreateIndex
CREATE INDEX "MonitoredBoard_enabled_idx" ON "MonitoredBoard"("enabled");

-- CreateIndex
CREATE INDEX "MonitoredBoard_isActive_idx" ON "MonitoredBoard"("isActive");

-- CreateIndex
CREATE INDEX "MonitoredBoard_cafeGame_idx" ON "MonitoredBoard"("cafeGame");

-- CreateIndex
CREATE INDEX "MonitoredBoard_projectId_idx" ON "MonitoredBoard"("projectId");

-- CreateIndex
CREATE INDEX "IssueComment_issueId_idx" ON "IssueComment"("issueId");

-- CreateIndex
CREATE INDEX "IssueComment_authorId_idx" ON "IssueComment"("authorId");

-- CreateIndex
CREATE INDEX "IssueComment_externalCommentId_idx" ON "IssueComment"("externalCommentId");

-- CreateIndex
CREATE INDEX "ReportItemData_reportId_idx" ON "ReportItemData"("reportId");

-- CreateIndex
CREATE INDEX "ReportItemData_date_idx" ON "ReportItemData"("date");

-- CreateIndex
CREATE INDEX "WeeklyReport_agentId_idx" ON "WeeklyReport"("agentId");

-- CreateIndex
CREATE INDEX "WeeklyReport_reportType_idx" ON "WeeklyReport"("reportType");

-- CreateIndex
CREATE INDEX "WeeklyReport_startDate_idx" ON "WeeklyReport"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyStat_weeklyReportId_key" ON "WeeklyStat"("weeklyReportId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ClassificationRule_projectId_idx" ON "ClassificationRule"("projectId");

-- CreateIndex
CREATE INDEX "ClassificationRule_isActive_idx" ON "ClassificationRule"("isActive");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "Agent"("status");

-- CreateIndex
CREATE INDEX "Agent_isActive_idx" ON "Agent"("isActive");

-- CreateIndex
CREATE INDEX "Agent_projectId_idx" ON "Agent"("projectId");

-- CreateIndex
CREATE INDEX "Agent_userId_idx" ON "Agent"("userId");

-- CreateIndex
CREATE INDEX "AgentSchedule_agentId_idx" ON "AgentSchedule"("agentId");

-- CreateIndex
CREATE INDEX "AgentSchedule_scheduleType_idx" ON "AgentSchedule"("scheduleType");

-- CreateIndex
CREATE INDEX "AgentSchedule_dayOfWeek_idx" ON "AgentSchedule"("dayOfWeek");

-- CreateIndex
CREATE INDEX "AgentSchedule_specificDate_idx" ON "AgentSchedule"("specificDate");

-- CreateIndex
CREATE INDEX "SlaPolicy_projectId_idx" ON "SlaPolicy"("projectId");

-- CreateIndex
CREATE INDEX "SlaPolicy_isActive_idx" ON "SlaPolicy"("isActive");

-- CreateIndex
CREATE INDEX "SlaPolicy_severity_idx" ON "SlaPolicy"("severity");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "MonitoringKeyword_type_idx" ON "MonitoringKeyword"("type");

-- CreateIndex
CREATE INDEX "MonitoringKeyword_enabled_idx" ON "MonitoringKeyword"("enabled");

-- CreateIndex
CREATE INDEX "MonitoringKeyword_word_idx" ON "MonitoringKeyword"("word");

-- CreateIndex
CREATE INDEX "RawLog_source_idx" ON "RawLog"("source");

-- CreateIndex
CREATE INDEX "RawLog_isProcessed_idx" ON "RawLog"("isProcessed");

-- CreateIndex
CREATE INDEX "RawLog_timestamp_idx" ON "RawLog"("timestamp");

-- CreateIndex
CREATE INDEX "RawLog_createdAt_idx" ON "RawLog"("createdAt");

-- CreateIndex
CREATE INDEX "RawLog_boardId_idx" ON "RawLog"("boardId");

-- CreateIndex
CREATE INDEX "RawLog_articleId_idx" ON "RawLog"("articleId");

-- CreateIndex
CREATE INDEX "RawLog_processingStatus_nextRetryAt_idx" ON "RawLog"("processingStatus", "nextRetryAt");

-- CreateIndex
CREATE INDEX "RawLog_processingStatus_isProcessed_idx" ON "RawLog"("processingStatus", "isProcessed");

-- CreateIndex
CREATE INDEX "CustomerFeedbackNotice_isActive_idx" ON "CustomerFeedbackNotice"("isActive");

-- CreateIndex
CREATE INDEX "CustomerFeedbackNotice_noticeDate_idx" ON "CustomerFeedbackNotice"("noticeDate");

-- CreateIndex
CREATE INDEX "CustomerFeedbackNotice_createdAt_idx" ON "CustomerFeedbackNotice"("createdAt");

-- CreateIndex
CREATE INDEX "CustomerFeedbackNoticeRead_noticeId_idx" ON "CustomerFeedbackNoticeRead"("noticeId");

-- CreateIndex
CREATE INDEX "CustomerFeedbackNoticeRead_agentId_idx" ON "CustomerFeedbackNoticeRead"("agentId");

-- CreateIndex
CREATE INDEX "CustomerFeedbackNoticeRead_readAt_idx" ON "CustomerFeedbackNoticeRead"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFeedbackNoticeRead_noticeId_agentId_key" ON "CustomerFeedbackNoticeRead"("noticeId", "agentId");

-- CreateIndex
CREATE INDEX "IssueShareLog_issueId_idx" ON "IssueShareLog"("issueId");

-- CreateIndex
CREATE INDEX "IssueShareLog_agentId_idx" ON "IssueShareLog"("agentId");

-- CreateIndex
CREATE INDEX "IssueShareLog_sentAt_idx" ON "IssueShareLog"("sentAt");

-- CreateIndex
CREATE INDEX "IssueShareLog_status_idx" ON "IssueShareLog"("status");

-- CreateIndex
CREATE INDEX "AIClassificationLog_issueId_idx" ON "AIClassificationLog"("issueId");

-- CreateIndex
CREATE INDEX "AIClassificationLog_userId_idx" ON "AIClassificationLog"("userId");

-- CreateIndex
CREATE INDEX "AIClassificationLog_agentId_idx" ON "AIClassificationLog"("agentId");

-- CreateIndex
CREATE INDEX "AIClassificationLog_createdAt_idx" ON "AIClassificationLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeVideoCaptionCache_videoId_key" ON "YouTubeVideoCaptionCache"("videoId");

-- CreateIndex
CREATE INDEX "YouTubeVideoCaptionCache_videoId_idx" ON "YouTubeVideoCaptionCache"("videoId");

-- CreateIndex
CREATE INDEX "YouTubeVideoCaptionCache_isBattlegroundsRelated_idx" ON "YouTubeVideoCaptionCache"("isBattlegroundsRelated");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptConfig_name_key" ON "AIPromptConfig"("name");

-- CreateIndex
CREATE INDEX "AIPromptConfig_name_idx" ON "AIPromptConfig"("name");

-- CreateIndex
CREATE INDEX "AIPromptConfig_isActive_idx" ON "AIPromptConfig"("isActive");

-- CreateIndex
CREATE INDEX "IssueLock_expiresAt_idx" ON "IssueLock"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueLock_issueId_key" ON "IssueLock"("issueId");

-- CreateIndex
CREATE INDEX "StepFloating_position_idx" ON "StepFloating"("position");

-- CreateIndex
CREATE INDEX "StepFloating_isActive_idx" ON "StepFloating"("isActive");

-- CreateIndex
CREATE INDEX "HandoverRecord_workDate_idx" ON "HandoverRecord"("workDate");

-- CreateIndex
CREATE INDEX "HandoverRecord_workType_idx" ON "HandoverRecord"("workType");

-- CreateIndex
CREATE UNIQUE INDEX "HandoverRecord_workDate_workType_key" ON "HandoverRecord"("workDate", "workType");

-- CreateIndex
CREATE INDEX "WorkChecklistItem_isActive_idx" ON "WorkChecklistItem"("isActive");

-- CreateIndex
CREATE INDEX "WorkChecklistItem_sortOrder_idx" ON "WorkChecklistItem"("sortOrder");

-- CreateIndex
CREATE INDEX "WorkChecklistItem_workType_idx" ON "WorkChecklistItem"("workType");

-- CreateIndex
CREATE INDEX "WorkChecklistItem_validFrom_idx" ON "WorkChecklistItem"("validFrom");

-- CreateIndex
CREATE INDEX "WorkChecklistItem_validTo_idx" ON "WorkChecklistItem"("validTo");

-- CreateIndex
CREATE INDEX "WorkChecklistExecution_userId_workDate_idx" ON "WorkChecklistExecution"("userId", "workDate");

-- CreateIndex
CREATE INDEX "WorkChecklistExecution_itemId_idx" ON "WorkChecklistExecution"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkChecklistExecution_userId_itemId_workDate_key" ON "WorkChecklistExecution"("userId", "itemId", "workDate");

-- CreateIndex
CREATE INDEX "WorkChecklistItemSortByType_workType_sortOrder_idx" ON "WorkChecklistItemSortByType"("workType", "sortOrder");

-- CreateIndex
CREATE INDEX "WorkChecklistAssignee_workType_idx" ON "WorkChecklistAssignee"("workType");

-- CreateIndex
CREATE INDEX "BoardListDailySnapshot_dateKst_idx" ON "BoardListDailySnapshot"("dateKst");

-- CreateIndex
CREATE INDEX "BoardListDailySnapshot_computedAt_idx" ON "BoardListDailySnapshot"("computedAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_platform_idx" ON "CalendarEvent"("platform");

-- CreateIndex
CREATE INDEX "CalendarEvent_startDate_idx" ON "CalendarEvent"("startDate");

-- CreateIndex
CREATE INDEX "CalendarEvent_endDate_idx" ON "CalendarEvent"("endDate");

-- CreateIndex
CREATE INDEX "CalendarEvent_startDate_endDate_idx" ON "CalendarEvent"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "WorkNotification_notificationDate_idx" ON "WorkNotification"("notificationDate");

-- CreateIndex
CREATE INDEX "WorkNotification_notificationTime_idx" ON "WorkNotification"("notificationTime");

-- CreateIndex
CREATE INDEX "WorkNotification_isActive_idx" ON "WorkNotification"("isActive");

-- CreateIndex
CREATE INDEX "WorkNotification_sent_idx" ON "WorkNotification"("sent");

-- CreateIndex
CREATE INDEX "WorkNotification_notificationDate_notificationTime_idx" ON "WorkNotification"("notificationDate", "notificationTime");

-- CreateIndex
CREATE INDEX "IssueCommentWatch_enabled_nextRunAt_idx" ON "IssueCommentWatch"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "LineChatTarget_type_idx" ON "LineChatTarget"("type");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemVOC" ADD CONSTRAINT "ReportItemVOC_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryGroup" ADD CONSTRAINT "CategoryGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CategoryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_categoryGroupId_fkey" FOREIGN KEY ("categoryGroupId") REFERENCES "CategoryGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_monitoredUrlId_fkey" FOREIGN KEY ("monitoredUrlId") REFERENCES "MonitoredUrl"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemIssue" ADD CONSTRAINT "ReportItemIssue_monitoredBoardId_fkey" FOREIGN KEY ("monitoredBoardId") REFERENCES "MonitoredBoard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredUrl" ADD CONSTRAINT "MonitoredUrl_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredBoard" ADD CONSTRAINT "MonitoredBoard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ReportItemIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItemData" ADD CONSTRAINT "ReportItemData_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyStat" ADD CONSTRAINT "WeeklyStat_weeklyReportId_fkey" FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginOtpChallenge" ADD CONSTRAINT "LoginOtpChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationRule" ADD CONSTRAINT "ClassificationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSchedule" ADD CONSTRAINT "AgentSchedule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedbackNoticeRead" ADD CONSTRAINT "CustomerFeedbackNoticeRead_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "CustomerFeedbackNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFeedbackNoticeRead" ADD CONSTRAINT "CustomerFeedbackNoticeRead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueShareLog" ADD CONSTRAINT "IssueShareLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ReportItemIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueShareLog" ADD CONSTRAINT "IssueShareLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIClassificationLog" ADD CONSTRAINT "AIClassificationLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ReportItemIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIClassificationLog" ADD CONSTRAINT "AIClassificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIClassificationLog" ADD CONSTRAINT "AIClassificationLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChecklistExecution" ADD CONSTRAINT "WorkChecklistExecution_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChecklistExecution" ADD CONSTRAINT "WorkChecklistExecution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChecklistItemSortByType" ADD CONSTRAINT "WorkChecklistItemSortByType_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorkChecklistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkChecklistAssignee" ADD CONSTRAINT "WorkChecklistAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardListDailySnapshot" ADD CONSTRAINT "BoardListDailySnapshot_monitoredBoardId_fkey" FOREIGN KEY ("monitoredBoardId") REFERENCES "MonitoredBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueCommentWatch" ADD CONSTRAINT "IssueCommentWatch_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ReportItemIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

