import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests lib/hubRoute.ts: where the Hub's Auto sends a request. Run: node scripts/test-hub.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const { hubRoute } = await import(pathToFileURL(path.join(here, "..", "lib", "hubRoute.ts")).href);
const cases = [
  ["What is the best cat in the world?", "chat"],
  ["Write a short poem about autumn", "chat"],
  ["How many open tasks do we have across how many machines?", "fleet"],
  ["What active sessions do I have going on right now?", "fleet"],
  ["Pause the fleet for one hour", "fleet"],
  ["Update all machines", "fleet"],
  ["Approve the LevelUp hand-off", "fleet"],
  ["Is Legion7 online?", "fleet"],
  ["Fix the failing tests in the usip repo", "agent"],
  ["Refactor the login component to use the new API", "agent"],
  ["Add a dark mode toggle to the settings page", "agent"],
  ["Explain how photosynthesis works", "chat"],
];
let n = 0;
for (const [text, want] of cases) {
  assert.equal(hubRoute(text).route, want, text);
  n++;
}
console.log(`ok - ${n} routing cases\n1 test passed`);
