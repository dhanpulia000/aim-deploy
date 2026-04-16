// inzoiApi.js
import fetch from "node-fetch";
import { BASE_URL, MONITOR_CATEGORY_IDS } from "./config.js";

// Fetch latest topics from Discourse
export async function fetchLatestTopics(maxPages = 3) {
  let results = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE_URL}/latest.json?page=${page}`;
    const res = await fetch(url);
    if (!res.ok) break;

    const json = await res.json();
    if (!json.topic_list?.topics?.length) break;

    results = results.concat(json.topic_list.topics);
  }

  return results;
}


// Fetch full topic details, including post stream
export async function fetchTopicDetails(topicId, slug) {
  // Discourse supports /t/{slug}/{id}.json, but also /t/{id}.json
  // We'll use slug + id for nicer URLs.
  const url = `${BASE_URL}/t/${slug}/${topicId}.json`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch topic ${topicId} (${slug}): ${res.status}`);
  }

  return res.json();
}
