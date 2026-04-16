// export.js
import ExcelJS from "exceljs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";
import { INZOI_DB_PATH, INZOI_EXPORT_DIR } from "./config.js";

// ensure export folder exists
fs.mkdirSync(INZOI_EXPORT_DIR, { recursive: true });

// Load SQLite database
async function loadDB() {
  return open({
    filename: INZOI_DB_PATH,
    driver: sqlite3.Database,
  });
}

// ---------------------------------------------------------------------
// 🕒 Timestamp converter
// ---------------------------------------------------------------------
function convertTimestamp(value) {
  if (!value || typeof value !== "string") return value;

  // Case 1: ISO 8601 timestamps from Discourse
  // Example: 2025-11-22T13:05:42Z
  if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) {
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date;
  }

  // Case 2: KST timestamps from monitor
  // Example: 2025.11.22. 13:05
  if (value.match(/^\d{4}\.\d{2}\.\d{2}\./)) {
    const cleaned = value.replace(/\./g, "").replace("KST", "").trim();
    // cleaned = "20251122 13:05"
    const match = cleaned.match(/(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2})/);
    if (match) {
      const [, y, m, d, hh, mm] = match;
      const date = new Date(`${y}-${m}-${d}T${hh}:${mm}:00+09:00`);
      return isNaN(date.getTime()) ? value : date;
    }
  }

  return value;
}

// ---------------------------------------------------------------------
// Convert row values so Excel recognizes timestamps
// ---------------------------------------------------------------------
function convertRow(row) {
  const converted = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    converted[key] = convertTimestamp(v);
  }
  return converted;
}

// ---------------------------------------------------------------------
// Export to Excel
// ---------------------------------------------------------------------
async function exportToExcel() {
  const db = await loadDB();
  const workbook = new ExcelJS.Workbook();

  // Apply consistent Excel datetime format
  const excelDatetimeFormat = "yyyy-mm-dd hh:mm:ss";

  // ---------------------------------------------------------------
  // Sheet 1: Topics
  // ---------------------------------------------------------------
  const topicsSheet = workbook.addWorksheet("Topics");
  const topics = await db.all(`SELECT * FROM inzoi_topics ORDER BY id ASC`);

  if (topics.length > 0) {
    topicsSheet.columns = Object.keys(topics[0]).map((key) => ({
      header: key,
      key: key,
      width: 25,
      style: {
        numFmt: key.toLowerCase().includes("date")
          ? excelDatetimeFormat
          : undefined,
      },
    }));

    topics.forEach((row) => {
      topicsSheet.addRow(convertRow(row));
    });
  } else {
    topicsSheet.addRow(["No topics found"]);
  }

  // ---------------------------------------------------------------
  // Sheet 2: Posts
  // ---------------------------------------------------------------
  const postsSheet = workbook.addWorksheet("Posts");
  const posts = await db.all(
    `SELECT * FROM inzoi_posts ORDER BY topic_id ASC, post_number ASC`,
  );

  if (posts.length > 0) {
    postsSheet.columns = Object.keys(posts[0]).map((key) => ({
      header: key,
      key: key,
      width: 25,
      style: {
        numFmt: key.toLowerCase().includes("date")
          ? excelDatetimeFormat
          : undefined,
      },
    }));

    posts.forEach((row) => {
      postsSheet.addRow(convertRow(row));
    });
  } else {
    postsSheet.addRow(["No posts found"]);
  }

  // Save file
  const filename = `inzoi_export_${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}.xlsx`;
  const fullPath = path.join(INZOI_EXPORT_DIR, filename);

  await workbook.xlsx.writeFile(fullPath);

  console.log(`✅ Export completed! File saved as: ${fullPath}`);
}

exportToExcel().catch((err) => {
  console.error("❌ Export failed:", err);
});
