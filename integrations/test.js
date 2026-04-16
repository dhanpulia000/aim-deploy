import { initDB } from "./db.js";
import { fetchLatestTopics, fetchTopic } from "./inzoi.js";

async function runTest() {
  const db = await initDB();

  console.log("📡 Fetching latest topics...");
  const topics = await fetchLatestTopics();

  for (const t of topics.slice(0, 100)) {  // fetch 0, N topics
    console.log(`\n📝 Topic: ${t.id} — ${t.title}`);

    // Insert into inzoi_topics
    // UPSERT topic
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
        t.id,
        t.slug,
        t.title,
        t.category_id,
        JSON.stringify(t.tags || []),
        t.created_at,
        t.last_posted_at,
        t.posts_count,
        t.views,
        t.like_count || 0,
        t.excerpt || ""
    ]
    );

    // Fetch full topic (posts)
    const full = await fetchTopic(t.id, t.slug);

    const posts = full.post_stream.posts;

    for (const p of posts) {
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
            t.id,
            p.post_number,
            p.username,
            p.user_id,
            p.cooked,
            p.raw,
            p.created_at,
            p.like_count || 0
        ]
        );
      console.log(`   → Saved post #${p.post_number} by ${p.username}`);
    }
  }

  console.log("\n✅ Test complete! Data saved into inzoi.db");
}

runTest();
