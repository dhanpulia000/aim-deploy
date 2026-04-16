// db.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { INZOI_DB_PATH } from "./config.js";

export async function initDB() {
  const db = await open({
    filename: INZOI_DB_PATH,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS inzoi_topics (
      id INTEGER PRIMARY KEY,           -- Discourse topic ID
      slug TEXT,
      title TEXT,
      category_id INTEGER,
      tags TEXT,
      created_at TEXT,
      last_posted_at TEXT,
      posts_count INTEGER,
      views INTEGER,
      like_count INTEGER,
      excerpt TEXT,
      embedding TEXT                    -- JSON-encoded float array for title+firstPost
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS inzoi_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER,
      post_number INTEGER,
      author_username TEXT,
      author_id INTEGER,
      cooked_html TEXT,
      raw_text TEXT,
      created_at TEXT,
      like_count INTEGER,
      UNIQUE(topic_id, post_number),
      FOREIGN KEY (topic_id) REFERENCES inzoi_topics(id)
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_inzoi_posts_topic_post
    ON inzoi_posts (topic_id, post_number);
  `);

  await db.exec(`
  CREATE TABLE IF NOT EXISTS duplicate_alerts (
    new_topic_id INTEGER,
    original_topic_id INTEGER,
    similarity REAL,
    alerted_at TEXT,
    PRIMARY KEY (new_topic_id, original_topic_id)
  );
`);

  return db;
}
