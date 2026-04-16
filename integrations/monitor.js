// monitor.js
import fetch from "node-fetch";
import { pipeline } from "@xenova/transformers";
import { initDB } from "./db.js";
import { fetchLatestTopics, fetchTopicDetails } from "./inzoiApi.js";
import {
  BASE_URL,
  CHECK_INTERVAL_MS,
  TOPIC_LIMIT_PER_CYCLE,
  PRIORITY_KEYWORDS,
  IGNORE_KEYWORDS,
  DISCORD_ALERT_WEBHOOK,
  DISCORD_HEARTBEAT_WEBHOOK,
} from "./config.js";

// -----------------------------------------------------------------------------
// Config for duplicate detection
// -----------------------------------------------------------------------------
const DUPLICATE_SIMILARITY_THRESHOLD = 0.8; // 0.80+ considered duplicate

async function hasDuplicateAlertBeenSent(db, newId, originalId) {
  const row = await db.get(
    `SELECT 1 FROM duplicate_alerts WHERE new_topic_id = ? AND original_topic_id = ?`,
    [newId, originalId]
  );
  return !!row;
}

async function recordDuplicateAlert(db, newId, originalId, score) {
  await db.run(
    `INSERT OR IGNORE INTO duplicate_alerts (new_topic_id, original_topic_id, similarity, alerted_at)
     VALUES (?, ?, ?, ?)`,
    [newId, originalId, score, new Date().toISOString()]
  );
}


// -----------------------------------------------------------------------------
// Helpers: time, delay, keyword detection
// -----------------------------------------------------------------------------

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function getKSTTimestamp() {
  const options = {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };
  const formatter = new Intl.DateTimeFormat("ko-KR", options);
  const parts = formatter.formatToParts(new Date());
  const map = {};
  parts.forEach(({ type, value }) => (map[type] = value));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second} KST`;
}

function detectKeywords(text, keywords, ignoreWords) {
  const lowered = (text || "").toLowerCase();
  const matched = keywords.filter((kw) =>
    lowered.includes(kw.toLowerCase())
  );
  if (matched.length === 0) return { confirmed: false, matched: [], ignore: null };

  const ignoreMatch = ignoreWords.find((iw) =>
    lowered.includes(iw.toLowerCase())
  );
  if (ignoreMatch) {
    return { confirmed: false, matched, ignore: ignoreMatch };
  }
  return { confirmed: true, matched, ignore: null };
}

async function sendDiscordMessage(webhookUrl, payload) {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("❌ Discord send failed:", await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ Error sending Discord message:", err.message);
    return false;
  }
}

function buildPostUrl(topicId, slug, postNumber) {
  if (!postNumber || postNumber === 1) {
    return `${BASE_URL}/t/${slug}/${topicId}`;
  }
  return `${BASE_URL}/t/${slug}/${topicId}/${postNumber}`;
}

// -----------------------------------------------------------------------------
// Embeddings (MiniLM) + cosine + caching
// -----------------------------------------------------------------------------

let encoder = null;

async function getEncoder() {
  if (!encoder) {
    encoder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return encoder;
}

async function embedText(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const enc = await getEncoder();
  const output = await enc(trimmed, { pooling: "mean", normalize: true });
  // output.data is a TypedArray
  return Array.from(output.data);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Build combined text for option B: title + first post
function buildCombinedText(title, firstPostRaw) {
  const t = (title || "").trim();
  const p = (firstPostRaw || "").trim();
  if (t && p) return `${t}\n\n${p}`;
  if (t) return t;
  if (p) return p;
  return "";
}

// Get or create embedding for a topic (title + first post)
async function getOrCreateTopicEmbedding(db, topicId, titleFromArg, firstPostRawFromArg) {
  // Try existing embedding
  const row = await db.get(
    `SELECT title, embedding FROM inzoi_topics WHERE id = ?`,
    [topicId]
  );

  let title = titleFromArg || row?.title || "";

  if (row && row.embedding) {
    try {
      return JSON.parse(row.embedding);
    } catch {
      // fall through and recompute
    }
  }

  // Need first post content
  let firstPostRaw = firstPostRawFromArg;
  if (!firstPostRaw) {
    const firstPostRow = await db.get(
      `SELECT raw_text FROM inzoi_posts WHERE topic_id = ? AND post_number = 1`,
      [topicId]
    );
    firstPostRaw = firstPostRow?.raw_text || "";
  }

  const combined = buildCombinedText(title, firstPostRaw);
  if (!combined.trim()) return null;

  const embArray = await embedText(combined);
  if (!embArray) return null;

  await db.run(
    `UPDATE inzoi_topics SET embedding = ? WHERE id = ?`,
    [JSON.stringify(embArray), topicId]
  );

  return embArray;
}

// Find best duplicate candidate for a new topic using semantic similarity
async function findDuplicateTopic(db, newTopicId, newTitle, newFirstPostRaw) {
  const newEmbedding = await getOrCreateTopicEmbedding(
    db,
    newTopicId,
    newTitle,
    newFirstPostRaw
  );
  if (!newEmbedding) return null;

  const rows = await db.all(
    `SELECT id, slug, title, embedding
     FROM inzoi_topics
     WHERE id != ?`,
    [newTopicId]
  );

  let best = null;
  let bestScore = 0;

  for (const row of rows) {
    let otherEmb = null;

    if (row.embedding) {
      try {
        otherEmb = JSON.parse(row.embedding);
      } catch {
        otherEmb = null;
      }
    }

    // If no embedding yet, lazily compute & cache it
    if (!otherEmb) {
      const firstPostRow = await db.get(
        `SELECT raw_text FROM inzoi_posts WHERE topic_id = ? AND post_number = 1`,
        [row.id]
      );
      const combinedOld = buildCombinedText(row.title, firstPostRow?.raw_text || "");
      if (!combinedOld.trim()) continue;

      otherEmb = await embedText(combinedOld);
      if (!otherEmb) continue;

      await db.run(
        `UPDATE inzoi_topics SET embedding = ? WHERE id = ?`,
        [JSON.stringify(otherEmb), row.id]
      );
    }

    const score = cosineSimilarity(newEmbedding, otherEmb);
    if (score > bestScore) {
      bestScore = score;
      best = {
        id: row.id,
        slug: row.slug,
        title: row.title,
        score,
      };
    }
  }

  if (best && bestScore >= DUPLICATE_SIMILARITY_THRESHOLD) {
    best.matchedBy = "semantic";
    return best;
  }

  return null;
}

// -----------------------------------------------------------------------------
// processTopic: UPSERT, embeddings, duplicate detection, priority alerts
// -----------------------------------------------------------------------------

async function processTopic(db, topicSummary) {
  const {
    id,
    slug,
    title,
    category_id,
    tags,
    created_at,
    last_posted_at,
    posts_count,
    views,
    like_count,
    excerpt,
  } = topicSummary;

  // UPSERT topic metadata
  await db.run(
    `INSERT INTO inzoi_topics
       (id, slug, title, category_id, tags, created_at, last_posted_at, posts_count, views, like_count, excerpt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       slug = excluded.slug,
       title = excluded.title,
       category_id = excluded.category_id,
       tags = excluded.tags,
       created_at = excluded.created_at,
       last_posted_at = excluded.last_posted_at,
       posts_count = excluded.posts_count,
       views = excluded.views,
       like_count = excluded.like_count,
       excerpt = excluded.excerpt
    `,
    [
      id,
      slug,
      title,
      category_id,
      JSON.stringify(tags || []),
      created_at,
      last_posted_at,
      posts_count,
      views,
      like_count || 0,
      excerpt || "",
    ]
  );

  // Fetch full topic (posts)
  const full = await fetchTopicDetails(id, slug);
  const posts = full.post_stream?.posts || [];

  let newPostsCount = 0;
  let alertsSent = 0;

  // Duplicate detection: use title + first post
  const firstPost = posts.find((p) => p.post_number === 1);
  const duplicate = await findDuplicateTopic(
    db,
    id,
    title,
    firstPost?.raw || ""
  );

  // 🚫 Skip duplicate alerts for Bug Report category (ID = 7)
  if (category_id === 7) {
    console.log(`ℹ️ Duplicate detection skipped for Bug Report topic ${id}`);
  } else if (duplicate && duplicate.id !== id) {

    const alreadySent = await hasDuplicateAlertBeenSent(db, id, duplicate.id);

    if (alreadySent) {
      console.log(
        `ℹ️ Duplicate alert suppressed (already sent): ${id} ≈ ${duplicate.id}`
      );
    } else {
      const newUrl = buildPostUrl(id, slug, 1);
      const oldUrl = buildPostUrl(duplicate.id, duplicate.slug, 1);

      const payload = {
        username: "inZOI Monitor",
        embeds: [
          {
            title: "⚠️ Possible Duplicate Topic Detected",
            color: 0xffaa00,
            fields: [
              { name: "New Topic", value: `[${title}](${newUrl})` },
              {
                name: "Original Topic",
                value: `[${duplicate.title}](${oldUrl})`,
              },
              { name: "Match Type", value: duplicate.matchedBy || "semantic" },
              {
                name: "Similarity",
                value: `${(duplicate.score * 100).toFixed(2)}%`,
              },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };

      await sendDiscordMessage(DISCORD_ALERT_WEBHOOK, payload);
      await recordDuplicateAlert(db, id, duplicate.id, duplicate.score);

      console.log(
        `⚠️ Duplicate detected (first time): topic ${id} ≈ topic ${duplicate.id} (${(
          duplicate.score * 100
        ).toFixed(2)}%)`
      );
    }
  }

  // Process posts: UPSERT + keyword detection for new posts
  for (const p of posts) {
    const {
      post_number,
      username,
      user_id,
      cooked,
      raw,
      created_at: postCreatedAt,
      like_count: postLikeCount,
    } = p;

    // Does it already exist?
    const existing = await db.get(
      `SELECT raw_text, like_count
       FROM inzoi_posts
       WHERE topic_id = ? AND post_number = ?`,
      [id, post_number]
    );

    const isNewPost = !existing;
    const hasChanged =
      existing &&
      (existing.raw_text !== raw ||
        existing.like_count !== (postLikeCount || 0));

    // UPSERT post
    await db.run(
      `INSERT INTO inzoi_posts
         (topic_id, post_number, author_username, author_id, cooked_html, raw_text, created_at, like_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(topic_id, post_number) DO UPDATE SET
         author_username = excluded.author_username,
         author_id = excluded.author_id,
         cooked_html = excluded.cooked_html,
         raw_text = excluded.raw_text,
         created_at = excluded.created_at,
         like_count = excluded.like_count
      `,
      [
        id,
        post_number,
        username,
        user_id,
        cooked,
        raw,
        postCreatedAt,
        postLikeCount || 0,
      ]
    );

    if (isNewPost) {
      newPostsCount++;

      const fullTextForDetection = `${title}\n${raw || ""}`;
      const detection = detectKeywords(
        fullTextForDetection,
        PRIORITY_KEYWORDS,
        IGNORE_KEYWORDS
      );

      if (detection.ignore) {
        console.log(
          `⚠️ False positive suppressed: keywords=[${detection.matched.join(
            ", "
          )}] blocked_by="${detection.ignore}"`
        );
      }

      if (detection.confirmed) {
        alertsSent++;
        const postUrl = buildPostUrl(id, slug, post_number);

        // Prefer raw, fall back to fullTextForDetection if empty
        const previewSource =
          raw && raw.trim().length > 0 ? raw : fullTextForDetection;

        const contentPreview = previewSource
          .replace(/\n+/g, " ")
          .replace(/\s+/g, " ")
          .slice(0, 500)
          .trim();

        const payload = {
          username: "inZOI Monitor",
          embeds: [
            {
              title: "🚨 Trigger Word Detected (inZOI Forum)",
              color: 0xff0000,
              fields: [
                { name: "Topic", value: title },
                { name: "Author", value: username, inline: true },
                { name: "Post #", value: `${post_number}`, inline: true },
                {
                  name: "Keyword(s)",
                  value: detection.matched.join(", "),
                },
                {
                  name: "Message",
                  value: contentPreview || "(empty)",
                },
                { name: "Link", value: postUrl },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        };

        await sendDiscordMessage(DISCORD_ALERT_WEBHOOK, payload);
        await delay(1000); // brief pause to avoid rate limits
        console.log(`🚨 Priority alert: topic=${id}, post #${post_number}`);
      }
    } else if (hasChanged) {
      console.log(
        `✏️ Updated post topic=${id}, post #${post_number} (edited / likes changed)`
      );
    }
  }

  return { newPostsCount, alertsSent };
}

// -----------------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------------

async function startMonitoring() {
  const db = await initDB();
  console.log("🚀 inZOI Forum Monitor (with embeddings) started.");

  while (true) {
    const cycleStart = Date.now();
    let topicsProcessed = 0;
    let totalNewPosts = 0;
    let totalAlerts = 0;

    try {
      console.log("\n📡 Fetching latest topics...");
      const latestTopics = await fetchLatestTopics(5); // or 5 pages
      const slice = latestTopics.slice(0, TOPIC_LIMIT_PER_CYCLE);
      console.log(
        `🧾 Found ${latestTopics.length} topics, processing ${slice.length} of them.`
      );

      for (const t of slice) {
        try {
          const { newPostsCount, alertsSent } = await processTopic(db, t);
          topicsProcessed++;
          totalNewPosts += newPostsCount;
          totalAlerts += alertsSent;
        } catch (err) {
          console.error(`❌ Error processing topic ${t.id}:`, err.message);
        }
      }

      const durationSec = ((Date.now() - cycleStart) / 1000).toFixed(1);
      const heartbeatPayload = {
        content:
          `💓 inZOI Monitor Heartbeat\n` +
          `⏱ Duration: ${durationSec}s\n` +
          `🧵 Topics processed: ${topicsProcessed}\n` +
          `📝 New posts: ${totalNewPosts}\n` +
          `🚨 Alerts sent: ${totalAlerts}\n` +
          `🕒 ${getKSTTimestamp()}`,
      };

      await sendDiscordMessage(DISCORD_HEARTBEAT_WEBHOOK, heartbeatPayload);
      console.log("💓 Heartbeat sent.");
    } catch (loopErr) {
      console.error("❌ Error in monitoring loop:", loopErr.message);
    }

    console.log(
      `⏳ Sleeping ${(CHECK_INTERVAL_MS / 1000).toFixed(0)}s before next cycle...\n`
    );
    await delay(CHECK_INTERVAL_MS);
  }
}

startMonitoring().catch((err) => {
  console.error("❌ Fatal error starting monitor:", err);
  process.exit(1);
});
