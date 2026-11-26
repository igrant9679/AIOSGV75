import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Unit test for lib/runPlacement.ts (which machine a project-run task goes to).
// Run: node scripts/test-run-placement.mjs   (Node 23.6+ reads the .ts file directly)
const here = path.dirname(fileURLToPath(import.meta.url));
const { placeTask, blockedReason } = await import(pathToFileURL(path.join(here, "..", "lib", "runPlacement.ts")).href);

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
console.log("all placement tests passed");
