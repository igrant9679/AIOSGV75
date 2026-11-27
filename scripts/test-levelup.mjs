import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests lib/levelupRules.ts: LevelUp hand-offs — where they run, what happens next, what LevelUp is told.
// Run: node scripts/test-levelup.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(path.join(here, "..", "lib", "levelupRules.ts")).href);

let n = 0;
const t = (name, fn) => {
  fn();
  console.log(`ok ${++n} - ${name}`);
};
const item = (over = {}, data = {}) => ({ id: 7, status: "requested", title: "Draft three LinkedIn posts", refType: "task", refId: "9", data: { kind: "task", access: "edit", area: { type: "client", name: "MeYouSocial" }, updates: [], ...data }, ...over });
const place = (o) => ({ key: o.label, kind: "machine", edit: true, local: true, lan: true, tool: "claude", ...o });
const pick = (ps) => ps[0] ?? null;
const usipPlace = place({ label: "Raider18 · Claude Code", host: "R", hostLabel: "Raider18", folder: "C:/Users/idris/usip" });
const areaPlace = place({ label: "Legion7 · Claude Code", host: "L", hostLabel: "Legion7", folder: "D:/MYS 2026" });
const ctx = { repos: ["igrant9679/usip", "igrant9679/levelup-second-brain", "sgrant5724/app"], places: { "igrant9679/usip": [usipPlace] }, areaPlaces: { MeYouSocial: areaPlace }, pick, myLabel: "Raider18" };

t("areas: the owner's choice, then obvious names, else none", () => {
  assert.equal(R.areaOfRepo("igrant9679/usip", { "igrant9679/USIP": "LSI Media" }), "LSI Media");
  assert.equal(R.areaOfRepo("x/communityforce-portal"), "CommunityForce");
  assert.equal(R.areaOfRepo("x/mys-site"), "MeYouSocial");
  assert.equal(R.areaOfRepo("x/lsi-media-web"), "LSI Media");
  assert.equal(R.areaOfRepo("igrant9679/mission-control"), "Personal");
  assert.equal(R.areaOfRepo("x/islsimilar"), null); // "lsi" inside a word is not LSI
  assert.equal(R.areaOfRepo("igrant9679/usip"), null);
});

t("a repository the text names: full name, or a unique whole-word short name", () => {
  assert.equal(R.repoMentioned("fix the login in igrant9679/usip please", ctx.repos), "igrant9679/usip");
  assert.equal(R.repoMentioned("look at usip's campaign page", ctx.repos), "igrant9679/usip");
  assert.equal(R.repoMentioned("the app is slow", ctx.repos), null); // "app" is under 4 letters
  assert.equal(R.repoMentioned("usipx stuff", ctx.repos), null);
});

t("plan: a named repository wins, with its best place", () => {
  const p = R.planFor(item({}, { instructions: "Change the onboarding copy in usip" }), ctx);
  assert.equal(p.repo, "igrant9679/usip");
  assert.equal(p.place.label, "Raider18 · Claude Code");
  assert.equal(p.access, "edit");
  assert.match(p.summary, /may change files/);
});

t("plan: else the area's work folder; a machine that doesn't allow edits makes it answer only", () => {
  const p = R.planFor(item(), ctx);
  assert.equal(p.place.folder, "D:/MYS 2026");
  assert.equal(p.access, "edit");
  const ro = R.planFor(item(), { ...ctx, areaPlaces: { MeYouSocial: { ...areaPlace, edit: false } } });
  assert.equal(ro.access, "answer");
});

t("plan: no repository and no area folder → home folder, answer only, and it says how to allow edits", () => {
  const p = R.planFor(item({}, { area: { type: "personal", name: "Personal", goalTitle: "Run a marathon" } }), ctx);
  assert.equal(p.place, null);
  assert.equal(p.access, "answer");
  assert.match(p.summary, /no files changed/);
  assert.match(p.summary, /set a work folder for Personal/);
  assert.doesNotMatch(R.planFor(item({}, { access: "answer", area: null }), ctx).summary, /to let it change files/);
});

t("next step: propose new ones; only the claiming machine moves it on", () => {
  assert.equal(R.nextStep(item(), undefined, "Raider18", "2026-11-27"), "propose");
  assert.equal(R.nextStep(item({ status: "requested" }, { claimedBy: "Legion7" }), undefined, "Raider18", "2026-11-27"), "none");
  assert.equal(R.nextStep(item({ status: "proposed" }, { claimedBy: "Raider18" }), { status: "todo", approval: "waiting" }, "Raider18", "2026-11-27"), "none");
  assert.equal(R.nextStep(item({ status: "proposed" }, { claimedBy: "Raider18" }), { status: "todo", approval: "approved" }, "Raider18", "2026-11-27"), "approve");
  assert.equal(R.nextStep(item({ status: "approved" }, { claimedBy: "Legion7" }), { status: "todo" }, "Raider18", "2026-11-27"), "none");
});

t("next step: approved work starts on its day, once", () => {
  const a = item({ status: "approved" }, { claimedBy: "Raider18", when: "2026-11-30" });
  assert.equal(R.nextStep(a, { status: "todo" }, "Raider18", "2026-11-27"), "none");
  assert.equal(R.nextStep(a, { status: "todo" }, "Raider18", "2026-11-30"), "start");
  assert.equal(R.nextStep(a, { status: "doing" }, "Raider18", "2026-11-30"), "none");
  // sent back from review: our copy is in review, LevelUp says approved again → start again
  assert.equal(R.nextStep(item({ status: "approved" }, { claimedBy: "Raider18" }), { status: "review" }, "Raider18", "2026-11-27"), "start");
});

t("next step: running → finish / fail; review → done when accepted here", () => {
  const r = item({ status: "running" }, { claimedBy: "Raider18" });
  assert.equal(R.nextStep(r, { status: "doing" }, "Raider18", "x"), "none");
  assert.equal(R.nextStep(r, { status: "review", result: { text: "ok" } }, "Raider18", "x"), "finish");
  assert.equal(R.nextStep(r, { status: "todo", result: { text: "", error: "boom" } }, "Raider18", "x"), "fail");
  assert.equal(R.nextStep(r, undefined, "Raider18", "x"), "fail");
  assert.equal(R.nextStep(item({ status: "review" }, { claimedBy: "Raider18" }), { status: "done" }, "Raider18", "x"), "done");
  assert.equal(R.nextStep(item({ status: "review" }, { claimedBy: "Raider18" }), { status: "review" }, "Raider18", "x"), "none");
});

t("next step: a cancel is acknowledged once, then mirrored; done is mirrored", () => {
  assert.equal(R.nextStep(item({ status: "cancelled" }, { claimedBy: "Raider18", cancelAck: false }), { status: "doing" }, "Raider18", "x"), "ack");
  assert.equal(R.nextStep(item({ status: "cancelled" }, { claimedBy: "Raider18", cancelAck: true }), { status: "dismissed" }, "Raider18", "x"), "none");
  assert.equal(R.nextStep(item({ status: "done" }, { claimedBy: "Raider18" }), { status: "review" }, "Raider18", "x"), "mirror");
  assert.equal(R.nextStep(item({ status: "done" }, { claimedBy: "Raider18" }), { status: "done" }, "Raider18", "x"), "none");
});

t("the worker's prompt carries the owner's words, the area, and what was sent back", () => {
  const it = item({}, { instructions: "Friendly, under 150 words each", snapshot: { notes: "Use the brand guide", subtasks: ["Post 1", "Post 2"], projectName: "Spring", due: "2026-12-01" }, updates: [{ at: "x", by: "owner", text: "Sent back: shorter please" }, { at: "y", by: "fleet", text: "Started" }] });
  const p = R.luPrompt(it, "answer", R.sentBackNotes(it));
  for (const s of ["their client MeYouSocial", "Friendly, under 150 words", "Use the brand guide", "- Post 2", "Due: 2026-12-01", "shorter please", "Don't change any files"]) assert.ok(p.includes(s), s);
  const proj = R.luPrompt(item({}, { kind: "project", area: { type: "personal", name: "Personal", goalTitle: "Run a marathon" } }), "edit");
  assert.match(proj, /a personal goal: Run a marathon/);
  assert.match(proj, /Plan it into steps first/);
  assert.match(proj, /may change files/);
});

t("the outbox: the owner's own tasks and results to review, never LevelUp's own hand-offs", () => {
  const base = { source: { kind: "doc", label: "STATUS.md" }, priority: 2, updatedAt: Date.now() };
  const out = R.outboxFrom([
    { ...base, id: "a", repo: "igrant9679/usip", title: "Sign in to Railway", status: "todo", assignee: { kind: "me" } },
    { ...base, id: "b", repo: "x/communityforce-portal", title: "Fix tests", status: "review", assignee: { kind: "machine" } },
    { ...base, id: "c", repo: "levelup", title: "From LevelUp", status: "review", assignee: { kind: "machine" }, origin: { kind: "levelup" } },
    { ...base, id: "d", repo: "x/y", title: "Done one", status: "done", assignee: { kind: "me" } },
  ], { "igrant9679/usip": "LSI Media" });
  assert.deepEqual(out.map((o) => [o.id, o.kind, o.area]), [["a", "yours", "LSI Media"], ["b", "review", "CommunityForce"]]);
});

console.log(`\n${n} tests passed`);
