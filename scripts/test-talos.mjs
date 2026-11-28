import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests the pure parts of Talos control (rule 47): what counts as yes, quiet hours, which events are sent,
// the morning digest, and the Telegram failover decision. Run: node scripts/test-talos.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const imp = (f) => import(pathToFileURL(path.join(here, "..", "lib", f)).href);
const T = await imp("talos.ts");
const N = await imp("talosNotify.ts");
const F = await imp("telegramFailover.ts");

let n = 0;
const t = (name, fn) => {
  fn();
  console.log(`ok ${++n} - ${name}`);
};

t("only a plain yes runs a card; anything else cancels", () => {
  for (const y of ["yes", "Yes", "YES!", "y", "ok", "go ahead", "do it", "confirm", "approved", "👍", "yes please"]) assert.ok(T.isYes(y), y);
  for (const no of ["no", "yes but not on Legion7", "wait", "", "maybe", "yes, and also delete everything", "not yes"]) assert.ok(!T.isYes(no), no);
});

t("quiet hours, including ones that wrap past midnight", () => {
  const at = (h, m = 0) => new Date(2026, 10, 28, h, m);
  assert.ok(N.inQuiet(at(23), "22:00", "07:00"));
  assert.ok(N.inQuiet(at(3), "22:00", "07:00"));
  assert.ok(!N.inQuiet(at(7), "22:00", "07:00"));
  assert.ok(!N.inQuiet(at(12), "22:00", "07:00"));
  assert.ok(N.inQuiet(at(13, 30), "13:00", "14:00"));
  assert.ok(!N.inQuiet(at(9), "08:00", "08:00")); // same start and end = no quiet hours
});

const snap = {
  machines: [
    { host: "L", label: "Legion7", online: true, lastSeenMinutesAgo: 0, subscriptions: [{ tool: "claude", status: "limited", resetsAt: "2026-11-28T18:00:00Z" }] },
    { host: "W", label: "WINAI5", online: false, lastSeenMinutesAgo: 25, subscriptions: [] },
    { host: "S", label: "Sabine-1", online: false, lastSeenMinutesAgo: 4, subscriptions: [] },
  ],
  work: [{ heldBy: "Raider18", open: 153, byWho: { you: 42, nobody: 79, "WINAI5 · Claude Code": 13 }, byStatus: { review: 1, doing: 2 }, review: [{ id: "r1", title: "Fix tests", who: "Raider18 · Claude Code", repo: "x/y" }], levelupWaitingApproval: [{ id: "lu-4", title: "Draft posts", who: "Raider18 · Claude Code" }] }],
  jobs: { failedLast24h: [{ id: "j1", mode: "new", machine: "Raider18", error: "timed out" }] },
  permissionPrompts: [{ id: "p1", host: "R", machine: "Raider18", tool: "claude", what: "Bash: npm test", project: "usip" }],
  approvals: [{ id: "a1" }],
  runs: [{ title: "Site audit", status: "running", done: 2, tasks: 5 }],
  schedules: [{ title: "LSI Monday Status", enabled: true, lastStatus: "failed: timed out" }],
  github: { waiting: 9 },
};

t("events: one per thing, with stable keys; recent offline blips and switched-off kinds left out", () => {
  const s = { events: { results: true, failures: true, permissions: true, levelup: true, offline: true, limits: true } };
  const ev = N.eventsFrom(snap, s, Date.parse("2026-11-28T12:00:00Z"));
  const keys = ev.map((e) => e.key.split(":")[0]);
  assert.deepEqual(keys.sort(), ["fail", "limit", "lu", "off", "perm", "review"]);
  assert.ok(ev.find((e) => e.key.startsWith("off:")).text.includes("WINAI5")); // Sabine-1 (4 min) is not yet "offline"
  assert.deepEqual(N.eventsFrom(snap, s).map((e) => e.key), N.eventsFrom(snap, s).map((e) => e.key)); // stable
  const few = N.eventsFrom(snap, { events: { ...s.events, results: false, limits: false } }).map((e) => e.key.split(":")[0]);
  assert.ok(!few.includes("review") && !few.includes("limit"));
});

t("the digest has the real numbers", () => {
  const d = N.digestText(snap);
  for (const s of ["Machines: 1 of 3 up", "down: WINAI5, Sabine-1", "153 open", "you 42", "1 to review", "1 LevelUp hand-off", "Approvals waiting: 1", "Permission prompts waiting: 1", "Site audit (running, 2/5)", "LSI Monday Status", "claude on Legion7", "GitHub waiting on you: 9"]) assert.ok(d.includes(s), s);
});

t("failover: takes over only after the primary is quiet long enough, hands back as soon as it returns", () => {
  const base = { enabled: true, active: false, primaryAgeMin: 3, minutes: 10, isPrimary: false };
  assert.equal(F.failoverDecision(base), "none");
  assert.equal(F.failoverDecision({ ...base, primaryAgeMin: 12 }), "start");
  assert.equal(F.failoverDecision({ ...base, active: true, primaryAgeMin: 12 }), "none");
  assert.equal(F.failoverDecision({ ...base, active: true, primaryAgeMin: 1 }), "stop");
  assert.equal(F.failoverDecision({ ...base, primaryAgeMin: null }), "none");
  assert.equal(F.failoverDecision({ ...base, enabled: false, primaryAgeMin: 60 }), "none");
  assert.equal(F.failoverDecision({ ...base, enabled: false, active: true }), "stop");
  assert.equal(F.failoverDecision({ ...base, isPrimary: true, primaryAgeMin: 60 }), "none"); // never on the primary itself
});

const S = await imp("fleetSnapshot.ts");
t("Work kept on several machines is one picture, not three", () => {
  const a = { heldBy: "Raider18", open: 153, byWho: { you: 42 }, byStatus: { review: 1 }, review: [{ id: "t1", title: "x" }], yours: [{ id: "y1" }, { id: "y2" }] };
  const b = { heldBy: "Idris-2-16gb", open: 154, byWho: { you: 43 }, byStatus: { review: 0 }, review: [], yours: [{ id: "y1" }, { id: "y3" }] };
  const m = S.mergeWork([a, b]);
  assert.equal(m.length, 1);
  assert.equal(m[0].open, 154);
  assert.equal(m[0].countsFrom, "Idris-2-16gb");
  assert.deepEqual(m[0].yours.map((x) => x.id), ["y1", "y2", "y3"]);
  assert.equal(m[0].review.length, 1);
  assert.match(m[0].note, /2 machines/);
  assert.equal(S.mergeWork([a]).length, 1);
  const d = N.digestText({ ...snap, work: m });
  assert.equal(d.split("\n").filter((l) => l.startsWith("Work")).length, 1);
});

t("schedules: only real problems are listed in the digest", () => {
  const d = N.digestText({ ...snap, schedules: [{ title: "Vault Librarian", enabled: true, lastStatus: "saved to vault" }, { title: "Ops Tuner", enabled: true, lastStatus: "delivered to Telegram" }, { title: "LSI Monday Status", enabled: true, lastStatus: "mission failed: timed out" }] });
  assert.match(d, /LSI Monday Status/);
  assert.doesNotMatch(d, /Vault Librarian|Ops Tuner/);
});

console.log(`\n${n} tests passed`);
