-- ReportItemIssue: Discourse(PlayInZOI) forum metrics for UI columns
ALTER TABLE "ReportItemIssue" ADD COLUMN IF NOT EXISTS "discourseViews" INTEGER;
ALTER TABLE "ReportItemIssue" ADD COLUMN IF NOT EXISTS "discourseLikeCount" INTEGER;
ALTER TABLE "ReportItemIssue" ADD COLUMN IF NOT EXISTS "discourseReplyCount" INTEGER;

