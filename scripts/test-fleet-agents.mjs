import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests lib/fleetAgentRules.ts: an agent's shape, its prompt, when a schedule is due. Run: node scripts/test-fleet-agents.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const R = await import(pathToFileURL(path.join(here, "..", "lib", "fleetAgentRules.ts")).href);
let n = 0;
const t = (name, fn) => { fn(); console.log(`ok ${++n} - ${name}`); };

t("an agent needs a name and a task; everything else has a safe default", () => {
  assert.throws(() => R.cleanAgent({ task: "do the thing please" }), /name/);
  assert.throws(() => R.cleanAgent({ name: "X", task: "hi" }), /task/);
  const a = R.cleanAgent({ name: " Scout ", task: "Find leads every morning", tool: "weird", access: "root", subAgents: 99, schedule: { freq: "daily", time: "25:99" } }, undefined, 1000);
  assert.equal(a.name, "Scout");
  assert.deepEqual([a.tool, a.access, a.subAgents, a.machine, a.folder, a.web, a.enabled], ["claude", "answer", 5, "auto", "~", true, true]);
  assert.deepEqual(a.schedule, { freq: "daily", time: "08:00" });
  const b = R.cleanAgent({ name: "Scout 2", task: "Find leads every morning", schedule: { freq: "never" } }, a, 2000);
  assert.equal(b.id, a.id); // an edit keeps its identity, history and creation time
  assert.equal(b.createdAt, 1000);
  assert.equal(b.schedule, null);
});

t("the prompt carries the persona, the task, the note and the limits", () => {
  const a = R.cleanAgent({ name: "Scout", persona: "You are patient.", task: "Find leads every morning", subAgents: 2, web: false });
  const p = R.agentPrompt(a, "only dentists");
  for (const s of ['"Scout"', "You are patient.", "Find leads every morning", "only dentists", "up to 2 helper sub-agents", "Don't use the web", "Don't change any files", "waits for the owner's OK", "NEEDS YOU:"]) assert.ok(p.includes(s), s);
  assert.match(R.agentPrompt(R.cleanAgent({ name: "B", task: "Build the thing now", access: "edit" })), /may change files/);
  assert.match(R.agentPrompt(R.cleanAgent({ name: "B", task: "Build the thing now" })), /Work alone/);
});

t("a schedule slot is due once, on its days, and not long after its time", () => {
  const at = (d, h, m = 0) => new Date(2026, 10, d, h, m); // November 2026: the 28th is a Saturday, the 30th a Monday
  assert.equal(R.dueSlot({ freq: "daily", time: "08:00" }, at(28, 7, 59)), null);
  assert.equal(R.dueSlot({ freq: "daily", time: "08:00" }, at(28, 8, 0)), "2026-11-28@08:00");
  assert.equal(R.dueSlot({ freq: "daily", time: "08:00" }, at(28, 13, 59)), "2026-11-28@08:00");
  assert.equal(R.dueSlot({ freq: "daily", time: "08:00" }, at(28, 14, 0)), null); // six hours on: too late, wait for tomorrow
  assert.equal(R.dueSlot({ freq: "weekdays", time: "08:00" }, at(28, 9)), null);
  assert.equal(R.dueSlot({ freq: "weekdays", time: "08:00" }, at(30, 9)), "2026-11-30@08:00");
  assert.equal(R.dueSlot({ freq: "weekly", time: "09:00", weekday: 1 }, at(30, 9, 5)), "2026-11-30@09:00");
  assert.equal(R.dueSlot({ freq: "weekly", time: "09:00", weekday: 1 }, at(28, 9, 5)), null);
  assert.equal(R.dueSlot({ freq: "hourly", time: "00:00" }, at(28, 15, 30)), "2026-11-28T15");
  assert.equal(R.dueSlot(null, at(28, 9)), null);
  assert.equal(R.scheduleText({ freq: "weekly", time: "09:00", weekday: 1 }), "Mondays at 09:00");
});

t("the starters are valid agents", () => {
  for (const tpl of R.AGENT_TEMPLATES) assert.ok(R.cleanAgent(tpl).id);
});
t("a sign-in failure means try another machine; an ordinary failure doesn't", () => {
  for (const e of ["Not logged in · Please run /login", "401 Unauthorized", "'codex' is not recognized as an internal or external command", "You are signed out"]) assert.ok(R.isSignInFailure(e), e);
  for (const e of ["The task timed out after 20 minutes", "Stopped from Raider18", "That folder isn't one this machine's sessions use.", ""]) assert.ok(!R.isSignInFailure(e), e);
});
console.log(`\n${n} tests passed`);
