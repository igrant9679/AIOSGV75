import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Unit tests for lib/repoTaskRules.ts (Work: task ids, repository of a git remote, who does a task).
// Run: node scripts/test-repo-tasks.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const { taskId, normalizeText, repoOfRemote, suggestAssignee, pickPlace } = await import(pathToFileURL(path.join(here, "..", "lib", "repoTaskRules.ts")).href);

let n = 0;
const t = (name, fn) => {
  fn();
  console.log(`ok ${++n} - ${name}`);
};

t("a task keeps its id when re-worded only in form", () => {
  const a = taskId("igrant9679/usip", "todo.md", "**Add** the OpenRouter key.");
  assert.equal(a, taskId("IGRANT9679/USIP", "todo.md", "add   the openrouter key"));
  assert.notEqual(a, taskId("igrant9679/usip", "HANDOFF.md", "add the openrouter key"), "a different source is a different task");
  assert.notEqual(a, taskId("igrant9679/usip", "todo.md", "add the anthropic key"));
  assert.equal(normalizeText("See [the guide](http://x) now:"), "see the guide now");
  assert.match(a, /^t[0-9a-z]+$/);
});

t("git remotes → owner/name", () => {
  assert.equal(repoOfRemote("https://github.com/igrant9679/AIOSGV75"), "igrant9679/aiosgv75");
  assert.equal(repoOfRemote("https://github.com/igrant9679/usip.git"), "igrant9679/usip");
  assert.equal(repoOfRemote("git@github.com:sgrant5724/spark.git"), "sgrant5724/spark");
  assert.equal(repoOfRemote("https://igrant9679@github.com/igrant9679/producer-studio.git\n"), "igrant9679/producer-studio");
  assert.equal(repoOfRemote("https://gitlab.com/a/b.git"), null);
});

t("owner tasks go to the owner; development work to an AI; nothing without a folder", () => {
  assert.equal(suggestAssignee({ title: "Run update.cmd on Legion7", owner: true, sourceKind: "doc" }, true).who, "owner");
  assert.equal(suggestAssignee({ title: "Paste the three app secrets in Settings", owner: false, sourceKind: "doc" }, true).who, "owner");
  assert.equal(suggestAssignee({ title: "Merge Velocity's OpenRouter change", owner: false, sourceKind: "doc" }, true).who, "owner");
  assert.equal(suggestAssignee({ title: "Sign in to Gemini", owner: false, sourceKind: "doc" }, true).who, "owner");
  assert.equal(suggestAssignee({ title: "Add image cropping to the upload form", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Fix the header font on the pricing page", owner: false, sourceKind: "issue" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Add image cropping", owner: false, sourceKind: "doc" }, false).who, "nobody");
  // the same words inside a feature description are not owner actions
  assert.equal(suggestAssignee({ title: "Add weekly digest email functionality", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Merge variable live-resolution at send: recent news", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Real SMTP transport (send only marks the row)", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "2 — Merge Velocity's OpenRouter change", owner: false, sourceKind: "doc" }, true).who, "owner", "a numbered instruction still starts with its verb");
  assert.equal(suggestAssignee({ title: "Store the Stripe API key in Railway", owner: false, sourceKind: "doc" }, true).who, "owner", "secrets wherever they appear");
  // found in the real repositories: features and findings that only mention these words
  assert.equal(suggestAssignee({ title: "Merge variable live-resolution at send: recent news, job changes, funding events", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Security: password-policy section (min length, complexity, rotation) — deferred", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Auth is client-side only; passwords live in the JSON blob and /api/* is fully open", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Publish → Publisher rename and the move to /publisher/: done 23 Sept", owner: false, sourceKind: "doc" }, true).who, "agent");
  assert.equal(suggestAssignee({ title: "Review the plan and approve it", owner: false, sourceKind: "doc" }, true).who, "owner");
  assert.equal(suggestAssignee({ title: "Paste the three app secrets", owner: false, sourceKind: "doc" }, true).who, "owner");
});

t("the best place: teammate, then this machine, then LAN; Claude before Codex", () => {
  const places = [
    { kind: "machine", local: false, lan: false, tool: "claude", id: "far" },
    { kind: "machine", local: false, lan: true, tool: "codex", id: "lan-codex" },
    { kind: "machine", local: true, tool: "codex", id: "here-codex" },
    { kind: "machine", local: true, tool: "claude", id: "here-claude" },
  ];
  assert.equal(pickPlace(places).id, "here-claude");
  assert.equal(pickPlace([...places, { kind: "teammate", id: "ada" }]).id, "ada");
  assert.equal(pickPlace(places.filter((p) => !p.local)).id, "lan-codex");
  assert.equal(pickPlace([]), null);
});

console.log(`\n${n} tests passed`);
