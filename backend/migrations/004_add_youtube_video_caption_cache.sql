CREATE TABLE IF NOT EXISTS YouTubeVideoCaptionCache (
  id TEXT PRIMARY KEY,
  videoId TEXT NOT NULL,
  captionText TEXT NULL,
  isBattlegroundsRelated INTEGER NOT NULL DEFAULT 0,
  analyzedAt TEXT NULL,
  createdAt TEXT NULL,
  updatedAt TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_youtube_video_caption_cache_video_id ON YouTubeVideoCaptionCache(videoId);
