#!/usr/bin/env node
// Mission Control session alerts + permission prompts.
//
// Claude Code runs this as a hook (Notification / Stop / SessionEnd), with the
// event as JSON on stdin; Codex runs it as its `notify` program, with the event
// as JSON in the last argument. It forwards the event to Mission Control on
// this machine (http://127.0.0.1:3000/api/hub/events), or, if Mission Control
// isn't running, appends it to data/hook-spool.jsonl to be picked up later.
//
// "permission" mode is Claude Code's PermissionRequest hook: it asks Mission
// Control whether to wait for an answer from the app (Allow / Deny from any
// machine). If so it waits and prints the decision; otherwise - or if the app
// isn't running, or nobody answers in time - it prints nothing and Claude Code
// carries on as usual (a terminal shows its prompt; a headless run is denied).
//
// It must never break a session: it always exits 0. Alert events return quickly.
// Installed and removed by Mission Control (Fleet -> Session alerts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "codex" ? "codex" : process.argv[2] === "permission" ? "permission" : "claude";
const source = mode === "codex" ? "codex" : "claude";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = "http://127.0.0.1:3000";

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let s = "";
    const done = () => resolve(s);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    setTimeout(done, 2000);
  });
}

async function permission() {
  const raw = await readStdin();
  if (!raw || !raw.trim().startsWith("{")) return;
  const payload = JSON.parse(raw);
  let ask;
  try {
    const r = await fetch(`${APP}/api/hub/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, jobId: process.env.MC_JOB_ID || undefined, headless: process.env.MC_HEADLESS === "1" }),
      signal: AbortSignal.timeout(3000),
    });
    ask = await r.json();
  } catch {
    return; // Mission Control isn't running: normal prompt
  }
  if (!ask || !ask.id) return;
  const until = Date.now() + (ask.waitMs || 60_000) + 5_000;
  while (Date.now() < until) {
    let w;
    try {
      const r = await fetch(`${APP}/api/hub/permissions?wait=${encodeURIComponent(ask.id)}`, { signal: AbortSignal.timeout(35_000) });
      w = await r.json();
    } catch {
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    if (!w || w.error) return;
    if (w.output) {
      await new Promise((res) => process.stdout.write(JSON.stringify(w.output), res));
      return;
    }
    if (w.status !== "pending") return;
  }
}

async function alert() {
  // Mission Control's own headless runs (replies, schedules, naming) aren't alerts
  if (process.env.MC_HEADLESS === "1") return;
  const raw = source === "codex" ? process.argv[process.argv.length - 1] : await readStdin();
  if (!raw || !raw.trim().startsWith("{")) return;
  const body = JSON.stringify({ source, payload: JSON.parse(raw), at: Date.now() });
  try {
    const r = await fetch(`${APP}/api/hub/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) return;
  } catch {
    /* Mission Control isn't up - spool it */
  }
  fs.mkdirSync(path.join(repo, "data"), { recursive: true });
  fs.appendFileSync(path.join(repo, "data", "hook-spool.jsonl"), body + "\n");
}

(mode === "permission" ? permission() : alert())
  .catch(() => {})
  .finally(() => process.exit(0));
