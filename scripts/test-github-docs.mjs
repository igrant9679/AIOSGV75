import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Unit tests for lib/githubDocs.ts (the GitHub dashboard's reading of status documents).
// Run: node scripts/test-github-docs.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const { docScore, docxText, extractWaiting, unzip } = await import(pathToFileURL(path.join(here, "..", "lib", "githubDocs.ts")).href);

let n = 0;
const t = (name, fn) => {
  fn();
  console.log(`ok ${++n} - ${name}`);
};

t("status documents are recognised, ordinary files aren't", () => {
  assert.equal(docScore("docs/This-Week-2026-11-23.md"), 10);
  assert.equal(docScore("THIS_WEEK.docx"), 10);
  assert.equal(docScore("weekly-update.txt"), 10);
  assert.ok(docScore("NEXT-SESSION.md") > 0 && docScore("docs/Mission-Control-Changes.docx") > 0 && docScore("CHANGELOG.md") > 0);
  assert.equal(docScore("README.md"), 0);
  assert.equal(docScore("src/weekly.ts"), 0, "code is not a document");
  assert.equal(docScore("LICENSE"), 0);
});

t("markdown: items under waiting-style headings only", () => {
  const md = [
    "# Status",
    "- shipped the thing",
    "## Waiting on you",
    "- Run update.cmd on Legion7",
    "- [ ] Sign in to Gemini",
    "- [x] Approve the plan",
    "Some prose that is not an item.",
    "1. Decide on WanGP",
    "### Details", // a sub-heading stays inside the section
    "- Node on the other machines",
    "## Done this week",
    "- not waiting",
  ].join("\n");
  const w = extractWaiting(md);
  assert.deepEqual(w.map((x) => x.text), ["Run update.cmd on Legion7", "Sign in to Gemini", "Decide on WanGP", "Node on the other machines"]);
  assert.equal(w[0].section, "Waiting on you");
});

t("bold pseudo-headings and tables (header and done rows skipped)", () => {
  const md = ["**For you to do:**", "- Reply to Sabine", "", "## Next steps", "| Item | Status | How |", "|---|---|---|", "| Update machines | to do | update.cmd |", "| Old thing | done | - |"].join("\n");
  assert.deepEqual(extractWaiting(md).map((x) => x.text), ["Reply to Sabine", "Update machines — to do — update.cmd"]);
});

t("a real .docx: Mission Control's own changes document", () => {
  const file = path.join(here, "..", "docs", "Mission-Control-Changes.docx");
  if (!fs.existsSync(file)) return;
  const buf = fs.readFileSync(file);
  assert.ok(unzip(buf).has("word/document.xml"));
  const text = docxText(buf);
  assert.match(text, /^# Mission Control: what changed this week/m, "title becomes a heading");
  assert.match(text, /^# Waiting on you$/m);
  const w = extractWaiting(text);
  assert.ok(w.length >= 8, `found ${w.length} waiting items`);
  assert.ok(w.some((x) => /Update the other five machines/.test(x.text)), "a known row of the table is among the items");
  assert.ok(w.every((x) => x.section === "Waiting on you"));
});

console.log(`\n${n} tests passed`);
