import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Unit test for lib/accountUsage.ts (Fleet → Accounts, and account-wide limits in run placement).
// Run: node scripts/test-account-usage.mjs   (Node 23.6+ reads the .ts file directly)
const here = path.dirname(fileURLToPath(import.meta.url));
const { accountUsage, withAccountLimits, parseClaudeLimit, projectFull } = await import(pathToFileURL(path.join(here, "..", "lib", "accountUsage.ts")).href);

const NOW = Date.UTC(2026, 10, 26, 18, 0); // 26 Nov 2026 18:00 UTC = 1pm New York
const H = 3_600_000;
const meter = (o) => ({ id: o.tool ?? "claude", tool: "claude", label: "Claude", status: "unknown", tokens5h: 0, tokens7d: 0, note: "", ...o });
const machine = (host, subs) => ({ host, label: host, subs });
let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok ${n} - ${name}`);
};

t("same login on two machines = one account, tokens added", () => {
  const a = accountUsage([machine("raider", [meter({ account: "aaa", tokens5h: 100, tokens7d: 1000 })]), machine("legion", [meter({ account: "aaa", tokens5h: 50, tokens7d: 500 })])], NOW);
  assert.equal(a.length, 1);
  assert.equal(a[0].tokens5h, 150);
  assert.equal(a[0].tokens7d, 1500);
  assert.equal(a[0].machines.length, 2);
  assert.equal(a[0].known, true);
});

t("different logins stay apart; no fingerprint = per machine", () => {
  const a = accountUsage([machine("raider", [meter({ account: "aaa" })]), machine("legion", [meter({ account: "bbb" })]), machine("old", [meter({})])], NOW);
  assert.equal(a.length, 3);
  assert.equal(a.find((x) => x.key === "claude@old").known, false);
});

t("not set up is left out", () => {
  assert.equal(accountUsage([machine("raider", [meter({ status: "not_set_up" })])], NOW).length, 0);
});

t("the newest limit reading wins, from any machine", () => {
  const codex = (o) => meter({ tool: "codex", account: "c1", status: "ok", windowLabel: "5h window", resetsAt: NOW + 2 * H, ...o });
  const a = accountUsage([machine("raider", [codex({ usedPercent: 20, observedAt: NOW - H })]), machine("legion", [codex({ usedPercent: 85, observedAt: NOW - 60_000 })])], NOW);
  assert.equal(a[0].usedPercent, 85);
  assert.equal(a[0].status, "near");
  assert.equal(a[0].observedOn, "legion");
});

t("a reading whose window has reset counts as 0%", () => {
  const a = accountUsage([machine("raider", [meter({ tool: "codex", account: "c1", status: "near", usedPercent: 90, observedAt: NOW - 6 * H, resetsAt: NOW - H, windowLabel: "5h window" })])], NOW);
  assert.equal(a[0].usedPercent, 0);
  assert.equal(a[0].status, "ok");
  assert.equal(a[0].resetsAt, undefined);
});

t("limited on one machine = limited for the account, until the reset", () => {
  const ms = [machine("raider", [meter({ account: "aaa" })]), machine("legion", [meter({ account: "aaa", status: "limited", observedAt: NOW - H, resetsAt: NOW + H })])];
  const a = accountUsage(ms, NOW);
  assert.equal(a[0].status, "limited");
  assert.equal(a[0].resetsAt, NOW + H);
  assert.match(a[0].note, /legion/);
  // after the reset it's over
  assert.equal(accountUsage(ms, NOW + 2 * H)[0].status, "unknown");
});

t("a limit with no reset time counts for 5 hours", () => {
  const ms = [machine("raider", [meter({ account: "aaa", status: "limited", observedAt: NOW - 4 * H })])];
  assert.equal(accountUsage(ms, NOW)[0].status, "limited");
  assert.equal(accountUsage(ms, NOW + 2 * H)[0].status, "unknown");
});

t("withAccountLimits spreads a limit to every machine on the login, not to others", () => {
  const ms = [
    { host: "raider", subs: [meter({ account: "aaa" })] },
    { host: "legion", subs: [meter({ account: "aaa", status: "limited", observedAt: NOW - H, resetsAt: NOW + H })] },
    { host: "area51", subs: [meter({ account: "bbb" })] },
  ];
  const out = withAccountLimits(ms, NOW);
  assert.equal(out[0].subs[0].status, "limited");
  assert.equal(out[2].subs[0].status, "unknown");
  assert.equal(ms[0].subs[0].status, "unknown", "input left alone");
});

t("projection: 50% used halfway through a 5h window fills at the reset (so: none); 60% at 2h fills before it", () => {
  const reset = NOW + 2.5 * H;
  assert.equal(projectFull(50, NOW, reset, 300), undefined);
  const full = projectFull(60, NOW, NOW + 3 * H, 300); // 2h in, 60% -> 100% at 3h20m in
  assert.equal(full, NOW + (4 / 6) * 2 * H);
  assert.equal(projectFull(5, NOW, NOW + 5 * H - 60_000, 300), undefined, "under 10 minutes of window: no guess");
});

t("parse: session limit with minutes, in New York, later the same day", () => {
  const ts = Date.UTC(2026, 6, 4, 21, 12); // 5:12pm EDT
  const r = parseClaudeLimit("You've hit your session limit Â· resets 6:10pm (America/New_York)", ts);
  assert.equal(r.kind, "session");
  assert.equal(r.resetsAt, Date.UTC(2026, 6, 4, 22, 10));
});

t("parse: a reset time earlier in the day means tomorrow", () => {
  const ts = Date.UTC(2026, 10, 26, 23, 0); // 6pm EST
  const r = parseClaudeLimit("You've hit your session limit · resets 1am (America/New_York)", ts);
  assert.equal(r.resetsAt, Date.UTC(2026, 10, 27, 6, 0));
});

t("parse: weekly limit with a date", () => {
  const ts = Date.UTC(2026, 10, 26, 12, 0);
  const r = parseClaudeLimit("You've hit your weekly limit · resets Nov 28, 3pm (Europe/London)", ts);
  assert.equal(r.kind, "weekly");
  assert.equal(r.resetsAt, Date.UTC(2026, 10, 28, 15, 0));
});

t("parse: the older epoch form, and text with no time", () => {
  assert.equal(parseClaudeLimit("Claude AI usage limit reached|1764358800", NOW).resetsAt, 1764358800000);
  assert.equal(parseClaudeLimit("You've hit your limit", NOW).resetsAt, undefined);
});

console.log(`\n${n} passed`);
