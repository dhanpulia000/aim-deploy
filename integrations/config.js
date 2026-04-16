// config.js

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// absolute paths, always relative to this project folder
export const INZOI_DB_PATH = path.resolve(__dirname, "./data/inzoi.db");
export const INZOI_EXPORT_DIR = path.resolve(__dirname, "./exports");

// Base Discourse forum URL
export const BASE_URL = "https://forum.playinzoi.com";

// Priority alert Discord webhook (replace with your real webhook)
export const DISCORD_ALERT_WEBHOOK = "";
// export const DISCORD_ALERT_WEBHOOK =
// "https://discord.com/api/webhooks/1445966123639111681/AuPxcSkDP_aCJFvFap0nkX6Tdi0qfi_aKo8GSA3eUISUbnLvTpO7OwCgF6rvMLKizAu-";

// Optional global heartbeat webhook (can be the same as above)
export const DISCORD_HEARTBEAT_WEBHOOK = "";

// export const DISCORD_HEARTBEAT_WEBHOOK =
// "https://discord.com/api/webhooks/1430803697671344199/IOq7b7bB3HeSQFC9DhOgtoMqA7yGvtN1EsCgb_8EXQMlFt5MwJjYdAfFovtYKfJQ0Fne";

// How often to poll the forum (ms)
export const CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Number of topics to inspect each cycle (Discourse latest.json returns ~30 by default)
export const TOPIC_LIMIT_PER_CYCLE = 1000;

// Keywords that indicate a potentially important/issue-related post
export const PRIORITY_KEYWORDS = [
  "crash",
  "bug",
  "error",
  "issue",
  "problem",
  "cannot start",
  "won't start",
  "not working",
  "freeze",
  "freezing",
  "stuck",
  "lag",
  "laggy",
  "disconnect",
  "disconnected",
  "connection lost",
  "server down",
  "can't login",
  "login issue",
  "unplayable",
  "broken",
  "doesn't work",
  "performance",
  "fps drop",
  "blue screen",
  "black screen",
];

// Words that often create false positives
export const IGNORE_KEYWORDS = [
  "debug",
  "bug report template",
  "known issues list",
];

// Optional: only monitor specific categories (by ID)
// If you want to filter later, you can use this. For now we use all topics.
export const MONITOR_CATEGORY_IDS = []; // e.g. [5, 7] if you want to restrict

// Similarity thresholds for duplicate detection
export const DUPLICATE_TITLE_THRESHOLD = 0.7; // 80% similar
export const DUPLICATE_CONTENT_THRESHOLD = 0.5; // 75%
export const DUPLICATE_ALERT_WEBHOOK = DISCORD_ALERT_WEBHOOK; // same or separate
