import fetch from "node-fetch";

const BASE = "https://forum.playinzoi.com";

// Fetch latest topics
export async function fetchLatestTopics() {
  const url = `${BASE}/latest.json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch latest topics: ${res.status}`);

  const json = await res.json();

  return json.topic_list.topics;  // Array of topics
}

// Fetch full topic details including posts
export async function fetchTopic(topic_id, slug) {
  const url = `${BASE}/t/${slug}/${topic_id}.json`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch topic ${topic_id}`);

  return res.json();
}
