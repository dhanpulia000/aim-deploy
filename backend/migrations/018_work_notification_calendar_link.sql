-- WorkNotification: link back to CalendarEvent
-- Applied by backend/server.js via libs/init-db.applyMigration()

ALTER TABLE WorkNotification ADD COLUMN calendarEventId INTEGER;

-- 1:1 link (allow many NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_worknotification_calendarEventId_unique
ON WorkNotification(calendarEventId)
WHERE calendarEventId IS NOT NULL;

