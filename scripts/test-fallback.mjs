import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// Unit tests for the pure rules behind: carrying a conversation to another tool when a plan hits its
// limit (lib/fallbackPlan.ts), what an ACP agent may do (lib/acpPolicy.ts), and reading the Team
// channel (lib/teamParse.ts).
// Run: node scripts/test-fallback.mjs   (Node 23.6+ reads the .ts files directly)
const here = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => import(pathToFileURL(path.join(here, "..", "lib", f)).href);
const { isLimitError, nextSteps, handoffPrompt, STEP_RE } = await load("fallbackPlan.ts");
const { permissionChoice, insideFolder, looksSignedOut, mayRun } = await load("acpPolicy.ts");
const { mentions, handoffs } = await load("teamParse.ts");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok ${n} - ${name}`);
};

// ─── limit errors ───
t("Claude's limit messages count as limits", () => {
  assert.ok(isLimitError("You've hit your session limit · resets 6:10pm (America/New_York)"));
  assert.ok(isLimitError("Claude AI usage limit reached|1764194400"));
  assert.ok(isLimitError("You've hit your weekly limit"));
});
t("Codex / Gemini / overload messages count", () => {
  assert.ok(isLimitError("You've hit your usage limit. Upgrade to Pro or try again in 2 days."));
  assert.ok(isLimitError("stream error: 429 Too Many Requests"));
  assert.ok(isLimitError("Gemini: the turn failed: Quota exceeded for quota metric"));
  assert.ok(isLimitError("RESOURCE_EXHAUSTED"));
  assert.ok(isLimitError("API Error: 529 Overloaded"));
});
t("ordinary failures do not", () => {
  assert.equal(isLimitError("The folder C:\\x doesn't exist on Raider18 any more."), false);
  assert.equal(isLimitError("Stopped after 20 minutes."), false);
  assert.equal(isLimitError("claude exited with code 1"), false);
  assert.equal(isLimitError(undefined), false);
  assert.equal(isLimitError("Stopped from Legion7."), false);
});

// ─── next steps ───
t("steps after the one that failed, in the owner's order", () => {
  assert.deepEqual(nextSteps(["claude", "codex", "local"], "claude", "answer"), ["codex", "local"]);
  assert.deepEqual(nextSteps(["claude", "codex", "local"], "codex", "answer"), ["claude", "local"]);
});
t("the local model never takes a run that may edit files", () => {
  assert.deepEqual(nextSteps(["claude", "codex", "local"], "claude", "edit"), ["codex"]);
});
t("tried and unknown steps are skipped, duplicates once", () => {
  assert.deepEqual(nextSteps(["claude", "acp:gemini", "rm -rf", "codex", "codex"], "claude", "answer", ["codex"]), ["acp:gemini"]);
  assert.ok(STEP_RE.test("acp:kimi") && !STEP_RE.test("acp:Bad.Id") && !STEP_RE.test("openai"));
});

// ─── handoff prompt ───
const conv = [
  { kind: "user", text: "Add a dark mode toggle" },
  { kind: "assistant", text: "Added it to Settings." },
  { kind: "tool", summary: "Edit: Settings.tsx" },
  { kind: "user", text: "Now make it remember the choice" },
];
t("the prompt names who it replaces, the folder, the history and the message once", () => {
  const p = handoffPrompt({ fromLabel: "Claude Code", reason: "session limit", entries: conv, message: "Now make it remember the choice", folder: "C:\\proj", max: 20_000 });
  assert.match(p, /taking over a conversation that was running in Claude Code/);
  assert.match(p, /C:\\proj/);
  assert.match(p, /USER: Add a dark mode toggle/);
  assert.match(p, /\[tool used: Edit: Settings.tsx\]/);
  assert.equal(p.split("Now make it remember the choice").length - 1, 1, "latest message appears once");
  assert.ok(p.trimEnd().endsWith("Now make it remember the choice"));
});
t("a small budget keeps the newest entries and says what was left out", () => {
  const long = Array.from({ length: 50 }, (_, i) => ({ kind: i % 2 ? "assistant" : "user", text: `message ${i} ${"x".repeat(200)}` }));
  const p = handoffPrompt({ fromLabel: "Codex", reason: "limit", entries: long, message: "next", max: 2_000 });
  assert.ok(p.length <= 2_000, `prompt is ${p.length}`);
  assert.match(p, /oldest entries were left out by Mission Control/);
  assert.match(p, /message 49/);
  assert.doesNotMatch(p, /message 0 /);
});
t("no history still gives a usable prompt", () => {
  const p = handoffPrompt({ fromLabel: "Claude Code", reason: "limit", entries: [], message: "hello", max: 6_000 });
  assert.match(p, /No earlier conversation could be read/);
});

// ─── ACP permissions ───
const opts = [
  { optionId: "a1", kind: "allow_once" },
  { optionId: "a2", kind: "allow_always" },
  { optionId: "r1", kind: "reject_once" },
  { optionId: "r2", kind: "reject_always" },
];
t("answer-only allows reading, refuses edits and commands", () => {
  assert.deepEqual(permissionChoice("read", "answer", opts), { allowed: true, outcome: { outcome: "selected", optionId: "a1" } });
  assert.deepEqual(permissionChoice("edit", "answer", opts), { allowed: false, outcome: { outcome: "selected", optionId: "r1" } });
  assert.equal(permissionChoice("execute", "answer", opts).allowed, false);
});
t("can-edit allows edits but never commands, deletes or unknown kinds", () => {
  assert.equal(permissionChoice("edit", "edit", opts).allowed, true);
  assert.equal(permissionChoice("move", "edit", opts).allowed, true);
  for (const k of ["execute", "delete", "switch_mode", "other", undefined]) assert.equal(mayRun(k, "edit"), false, String(k));
});
t("never 'always'; no one-off allow means no", () => {
  assert.deepEqual(permissionChoice("read", "edit", [{ optionId: "a2", kind: "allow_always" }, { optionId: "r1", kind: "reject_once" }]), { allowed: false, outcome: { outcome: "selected", optionId: "r1" } });
  assert.deepEqual(permissionChoice("edit", "answer", [{ optionId: "r2", kind: "reject_always" }]), { allowed: false, outcome: { outcome: "cancelled" } });
});
t("files only inside the session's folder", () => {
  assert.ok(insideFolder("C:\\Users\\me\\proj", "src\\a.ts", "win32"));
  assert.ok(insideFolder("C:\\Users\\me\\proj", "c:\\users\\ME\\proj\\b.ts", "win32"));
  assert.equal(insideFolder("C:\\Users\\me\\proj", "..\\secret.txt", "win32"), false);
  assert.equal(insideFolder("C:\\Users\\me\\proj", "C:\\Users\\me\\proj-other\\x", "win32"), false);
  assert.equal(insideFolder("C:\\Users\\me\\proj", "D:\\x", "win32"), false);
  assert.ok(insideFolder("/home/me/proj", "a/b.md", "linux"));
  assert.equal(insideFolder("/home/me/proj", "/etc/passwd", "linux"), false);
  assert.equal(insideFolder("/home/me/proj", "", "linux"), false);
});
t("a signed-out agent is recognised", () => {
  assert.ok(looksSignedOut("Gemini API key is missing or not configured."));
  assert.ok(looksSignedOut("Authentication required"));
  assert.equal(looksSignedOut("Quota exceeded"), false);
});

// ─── Team channel ───
const team = [
  { id: "a", name: "Ada" },
  { id: "l", name: "Linus" },
  { id: "g", name: "Grace" },
];
t("mentions: names in order, case-insensitive, once; emails are not mentions", () => {
  assert.deepEqual(mentions("@linus can you fix it? @Ada and @LINUS again", team), ["l", "a"]);
  assert.deepEqual(mentions("mail grace@example.com", team), []);
  assert.deepEqual(mentions("@Nobody hi", team), []);
});
t("hand-offs: '@Name: task' lines, not to yourself, one per teammate", () => {
  const reply = "Fixed in session.ts.\n\n@Grace: review session.ts\n- **@Linus**: run the Safari test\n@Ada: thanks\n@Grace: and the docs";
  assert.deepEqual(handoffs(reply, team, "a"), [
    { to: "g", text: "review session.ts" },
    { to: "l", text: "run the Safari test" },
  ]);
  assert.deepEqual(handoffs("I talked to @Grace about it.", team, "a"), [], "a mention in a sentence is not a hand-off");
});

console.log(`\n${n} tests passed`);
