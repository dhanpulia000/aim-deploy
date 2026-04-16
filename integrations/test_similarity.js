// test_similarity.js
import { similarity } from "./similarity.js";

console.log("\n🎮 === inZOI Similarity Test Suite ===\n");

async function runTest(label, a, b) {
  const score = await similarity(a, b);
  console.log(`🔍 ${label}`);
  console.log(`Similarity Score: ${(score * 100).toFixed(2)}%`);
  console.log("----------------------------------------\n");
}

async function run() {
  // -------- Samples ----------
  const lowA = `
The dragon boss in Eldoria drops a rare crafting crystal.
Players team up in raids to beat its enrage timer.
`;
  const lowB = `
The new racing update adds hover bikes that drift in zero gravity.
Precision is more important than combat in the time trials.
`;

  const mediumA = `
The latest patch improved game performance in crowded cities.
Players report smoother frame rates with high textures.
`;
  const mediumB = `
Many users reported better FPS after the update, although some
still see occasional drops in open world areas.
`;

  const highA = `
The game crashes when loading into multiplayer matches,
especially after installing the new update.
Developers confirmed they are investigating the crash issue.
`;
  const highB = `
After the recent update, the game often crashes when joining
online team matches. The developers acknowledged the problem
and are working on a multiplayer crash fix.
`;

  // -------- Run Tests ----------
  console.log("🧪 Testing low similarity (expected ~10–25%)");
  await runTest("Low Similarity Test", lowA, lowB);

  console.log("🧪 Testing medium similarity (expected ~40–60%)");
  await runTest("Medium Similarity Test", mediumA, mediumB);

  console.log("🧪 Testing high similarity (expected ~75–90%)");
  await runTest("High Similarity Test", highA, highB);

  console.log("🎉 All tests complete.\n");
}

run();
