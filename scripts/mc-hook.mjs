#!/usr/bin/env node
// Mission Control session alerts.
//
// Claude Code runs this as a hook (Notification / Stop / SessionEnd), with the
// event as JSON on stdin; Codex runs it as its `notify` program, with the event
// as JSON in the last argument. It forwards the event to Mission Control on
// this machine (http://127.0.0.1:3000/api/hub/events), or, if Mission Control
// isn't running, appends it to data/hook-spool.jsonl to be picked up later.
//
// It must never slow down or break a session: it always exits 0, quickly.
// Installed and removed by Mission Control (Fleet -> Session alerts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = process.argv[2] === "codex" ? "codex" : "claude";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function main() {
  // Mission Control's own headless runs (replies, schedules, naming) aren't alerts
  if (process.env.MC_HEADLESS === "1") return;
  const raw = source === "codex" ? process.argv[process.argv.length - 1] : await readStdin();
  if (!raw || !raw.trim().startsWith("{")) return;
  const body = JSON.stringify({ source, payload: JSON.parse(raw), at: Date.now() });
  try {
    const r = await fetch("http://127.0.0.1:3000/api/hub/events", {
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

main()
  .catch(() => {})
  .finally(() => process.exit(0));
