-- WorkNotification: SQLite에서 런타임 ALTER로만 있던 컬럼 (업무 알림 반복 스케줄)
ALTER TABLE "WorkNotification" ADD COLUMN IF NOT EXISTS "repeatType" TEXT;
ALTER TABLE "WorkNotification" ADD COLUMN IF NOT EXISTS "startDate" TEXT;
ALTER TABLE "WorkNotification" ADD COLUMN IF NOT EXISTS "endDate" TEXT;
ALTER TABLE "WorkNotification" ADD COLUMN IF NOT EXISTS "dayOfWeek" INTEGER;
ALTER TABLE "WorkNotification" ADD COLUMN IF NOT EXISTS "dayOfMonth" INTEGER;
ALTER TABLE "WorkNotification" ADD COLUMN IF NOT EXISTS "lastSentDate" TEXT;
