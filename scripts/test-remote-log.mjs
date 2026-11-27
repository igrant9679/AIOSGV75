import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Unit test for lib/remoteCheck.ts (Fleet → Remote actions: merging every machine's log, and
// flagging a request its named sender has no record of sending).
// Run: node scripts/test-remote-log.mjs   (Node 23.6+ reads the .ts file directly)
const here = path.dirname(fileURLToPath(import.meta.url));
const { crossCheck } = await import(pathToFileURL(path.join(here, "..", "lib", "remoteCheck.ts")).href);

const NOW = Date.UTC(2026, 10, 26, 18, 0);
const M = 60_000;
const e = (o) => ({ kind: "reply", via: "vault", what: "x", outcome: "accepted", ...o });
const legion = {
  v: 1,
  host: "legion",
  label: "Legion7",
  publishedAt: NOW - 5 * M,
  coversFrom: NOW - 600 * M,
  entries: [
    e({ id: "a", dir: "in", host: "legion", from: "raider", at: NOW - 60 * M }),
    e({ id: "b", dir: "in", host: "legion", from: "raider", at: NOW - 50 * M }), // raider never sent b
    e({ id: "c", dir: "in", host: "legion", from: "area51", at: NOW - 40 * M }), // area51 keeps no log
    e({ id: "d", dir: "in", host: "legion", from: "raider", at: NOW - 40 * M, outcome: "refused" }),
    e({ id: "f", dir: "in", host: "legion", from: "raider", at: NOW - 2 * M }), // newer than raider's last share
  ],
};
const raider = {
  v: 1,
  host: "raider",
  label: "Raider18",
  publishedAt: NOW - 3 * M,
  coversFrom: NOW - 900 * M,
  entries: [
    e({ id: "a", dir: "out", host: "legion", from: "raider", at: NOW - 61 * M, outcome: "sent", status: "done" }),
    e({ id: "z", dir: "out", host: "legion", from: "raider", at: NOW - 70 * M, outcome: "sent" }),
  ],
};

const rows = crossCheck([raider, legion], NOW);
const row = (id) => rows.find((r) => r.id === id);
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok ${n} - ${name}`);
};

t("one row per action: the target's 'in' record, with the sender's status folded in", () => {
  assert.equal(rows.filter((r) => r.id === "a").length, 1);
  assert.equal(row("a").dir, "in");
  assert.equal(row("a").status, "done");
  assert.equal(row("a").unmatched, undefined);
});
t("a request the named sender has no record of sending is flagged", () => assert.match(row("b").unmatched, /Raider18|raider/));
t("no flag when the sender keeps no log (older version)", () => assert.equal(row("c").unmatched, undefined));
t("no flag on a refused request (nothing ran)", () => assert.equal(row("d").unmatched, undefined));
t("no flag before the sender has shared since the request", () => assert.equal(row("f").unmatched, undefined));
t("an 'out' with no 'in' yet is still shown", () => assert.equal(row("z").dir, "out"));
t("no flag when the sender's log doesn't reach back that far", () => {
  const r = crossCheck([{ ...raider, coversFrom: NOW - 45 * M }, legion], NOW);
  assert.equal(r.find((x) => x.id === "b").unmatched, undefined);
});
t("newest first", () => assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].at >= r.at)));

console.log(`\n${n} passed`);
