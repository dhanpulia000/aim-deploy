// similarity.js
import { pipeline } from "@xenova/transformers";

let encoder = null;

// Lazy-load embedding model once
async function loadModel() {
  if (!encoder) {
    encoder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return encoder;
}

function cosineSim(vecA, vecB) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] ** 2;
    magB += vecB[i] ** 2;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function similarity(a, b) {
  if (!a || !b) return 0;

  const enc = await loadModel();

  const embedA = await enc(a, { pooling: "mean", normalize: true });
  const embedB = await enc(b, { pooling: "mean", normalize: true });

  return cosineSim(embedA.data, embedB.data);
}
