import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Unit test for lib/runPlacement.ts (which machine a project-run task goes to).
// Run: node scripts/test-run-placement.mjs   (Node 23.6+ reads the .ts file directly)
const here = path.dirname(fileURLToPath(import.meta.url));
const { placeTask, blockedReason, pickLocalMachine } = await import(pathToFileURL(path.join(here, "..", "lib", "runPlacement.ts")).href);

const sub = (tool, status = "ok", usedPercent) => ({ id: tool, tool, label: tool, status, usedPercent, tokens5h: 0, tokens7d: 0, note: "" });
const all = [sub("claude", "ok", 40), sub("codex", "ok", 40), sub("hermes", "ok")];
const M = (o) => ({ host: "x", label: "x", home: false, online: true, via: "lan", accepts: "answer", runWorker: true, subs: all, busy: 0, folder: "~", ...o });

const home = M({ host: "raider", label: "Raider18", home: true, via: "self", accepts: "edit" });
const legion = M({ host: "legion", label: "Legion7" });
const area = M({ host: "area51", label: "Area51", via: "vault" });
const old = M({ host: "old", label: "Old", runWorker: false });
const off = M({ host: "off", label: "Off", accepts: "off" });
const down = M({ host: "down", label: "Down", online: false });
const fleet = (h = {}) => [M({ ...home, ...h }), legion, area, old, off, down];

let p;
// 1. idle home wins
p = placeTask(fleet(), { tools: ["hermes", "codex", "claude"], pinned: false });
assert.equal(p.host, "raider"); assert.equal(p.tool, "hermes");
// 2. busy home → LAN machine
p = placeTask(fleet({ busy: 2 }), { tools: ["hermes", "codex", "claude"], pinned: false });
assert.equal(p.host, "legion"); assert.match(p.why, /Legion7 is idle/);
// 3. one task already on the run's machine → an idle LAN machine wins
p = placeTask(fleet({ busy: 1 }), { tools: ["claude"], pinned: false });
assert.equal(p.host, "legion");
// 4. pinned (edit) always home, even when busy
p = placeTask(fleet({ busy: 5 }), { tools: ["codex", "claude"], pinned: true });
assert.equal(p.host, "raider");
// 5. a machine on the avoid list is skipped; a OneDrive-only machine wins only when home is much busier
p = placeTask(fleet({ busy: 3 }), { tools: ["claude"], pinned: false, avoid: ["legion"] });
assert.equal(p.host, "area51");
p = placeTask(fleet({ busy: 2 }), { tools: ["claude"], pinned: false, avoid: ["legion"] });
assert.equal(p.host, "raider", "home busy 2 beats a OneDrive-only machine");
// 6. old version / off / offline never chosen
for (const m of [old, off, down]) assert.notEqual(blockedReason(m, { tools: ["claude"], pinned: false }, "claude"), null);
assert.match(blockedReason(old, { tools: ["claude"], pinned: false }, "claude"), /older version/);
// 7. the cheaper tool on another machine beats a dearer tool at home
p = placeTask([M({ ...home, subs: [sub("claude"), sub("codex"), sub("hermes", "limited")] }), legion], { tools: ["hermes", "codex", "claude"], pinned: false });
assert.equal(p.tool, "hermes"); assert.equal(p.host, "legion");
// 8. nothing has hermes/codex → claude, skipped listed
p = placeTask([M({ ...home, subs: [sub("claude")] })], { tools: ["hermes", "codex", "claude"], pinned: false });
assert.equal(p.tool, "claude"); assert.deepEqual(p.skipped, ["hermes", "codex"]);
// 9. remote without the project's folder is not eligible
p = placeTask([M({ ...home, busy: 4, folder: "C:/proj" }), M({ ...legion, folder: undefined })], { tools: ["claude"], pinned: false });
assert.equal(p.host, "raider");
// 10. full remote machine (2 of our jobs) not eligible
assert.equal(blockedReason(M({ ...legion, busy: 2 }), { tools: ["claude"], pinned: false }, "claude"), "busy");
// 11. home limited for claude, pinned → null (caller falls back)
p = placeTask([M({ ...home, subs: [sub("claude", "limited")] }), legion], { tools: ["claude"], pinned: true });
assert.equal(p, null);
// 12. memory: a remote machine at its limit gets nothing; the home machine's own tasks still go home
assert.match(blockedReason(M({ ...legion, memory: 95 }), { tools: ["claude"], pinned: false }, "claude"), /memory nearly full/);
p = placeTask([M({ ...home, memory: 96 }), M({ ...legion, memory: 95 })], { tools: ["claude"], pinned: false });
assert.equal(p.host, "raider", "nowhere else to go: home");
p = placeTask([M({ ...home, memory: 96 }), M({ ...legion, memory: 95 })], { tools: ["claude"], pinned: true });
assert.equal(p.host, "raider");
// 13. an idle home under memory pressure hands movable work to a roomier machine; a little pressure doesn't
p = placeTask([M({ ...home, memory: 94 }), legion], { tools: ["claude"], pinned: false });
assert.equal(p.host, "legion");
p = placeTask([M({ ...home, memory: 80 }), legion], { tools: ["claude"], pinned: false });
assert.equal(p.host, "raider", "below MEM_WARN memory costs nothing");
// 14. between two remote machines the emptier one wins
p = placeTask([M({ ...home, busy: 2 }), M({ ...legion, memory: 91 }), M({ host: "sabine", label: "Sabine", memory: 40 })], { tools: ["claude"], pinned: false });
assert.equal(p.host, "sabine");
// 15. another machine's local model (pickLocalMachine): only machines that share one, not this one
const lm = (o) => M({ localModel: "inkling-2-mini", memory: 50, ...o });
assert.equal(pickLocalMachine([M({ ...home, localModel: "llama" }), legion, area]), null, "nobody else shares a local model; this machine never picks itself");
let q = pickLocalMachine([home, lm({ host: "gv", label: "GV", via: "vault", memory: 20 }), lm({ host: "legion", label: "Legion7", memory: 60 })]);
assert.equal(q.host, "legion", "LAN beats OneDrive even with more memory used");
q = pickLocalMachine([home, lm({ host: "a", memory: 70 }), lm({ host: "b", memory: 30 })]);
assert.equal(q.host, "b", "then the least memory used");
// 16. memory at MEM_WARN, a local task already in flight, avoided, off or offline: skipped
assert.equal(pickLocalMachine([home, lm({ host: "a", memory: 85 })]), null, "a local model loads gigabytes: not on a machine at 85%");
assert.equal(pickLocalMachine([home, lm({ host: "a", localBusy: 1 })]), null, "Ollama answers one at a time");
assert.equal(pickLocalMachine([home, lm({ host: "a" })], ["a"]), null, "skipped for this task before");
assert.equal(pickLocalMachine([home, lm({ host: "a", accepts: "off" }), lm({ host: "b", online: false })]), null);
assert.equal(pickLocalMachine([home, lm({ host: "a", memory: undefined })]).host, "a", "unknown memory is not a reason to skip (rule 31)");
assert.equal(pickLocalMachine([home, lm({ host: "a", localFits: false }), lm({ host: "b", via: "vault" })]).host, "b", "a machine that says its model won't fit in memory now is skipped");
console.log("all placement tests passed");
