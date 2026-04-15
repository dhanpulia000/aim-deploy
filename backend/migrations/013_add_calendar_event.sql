CREATE TABLE IF NOT EXISTS CalendarEvent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  startDate TEXT NOT NULL,
  endDate TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendarevent_platform ON CalendarEvent(platform);
CREATE INDEX IF NOT EXISTS idx_calendarevent_startDate ON CalendarEvent(startDate);
CREATE INDEX IF NOT EXISTS idx_calendarevent_endDate ON CalendarEvent(endDate);
CREATE INDEX IF NOT EXISTS idx_calendarevent_startDate_endDate ON CalendarEvent(startDate, endDate);
