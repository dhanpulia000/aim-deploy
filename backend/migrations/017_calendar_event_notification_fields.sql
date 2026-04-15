-- CalendarEvent: work-notification sync fields
-- Applied by backend/server.js via libs/init-db.applyMigration()

ALTER TABLE CalendarEvent ADD COLUMN lineChannelId TEXT;
ALTER TABLE CalendarEvent ADD COLUMN discordWebhookUrl TEXT;
ALTER TABLE CalendarEvent ADD COLUMN discordMention TEXT;
ALTER TABLE CalendarEvent ADD COLUMN message TEXT;

