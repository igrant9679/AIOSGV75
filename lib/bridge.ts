import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";
import { clusterStatus, isMasterNow, readConfig } from "./cluster";
import { createApproval, listApprovals } from "./approvals";
import { listMissions, startMission } from "./missions";
import { hubSnapshot } from "./activity";
import { listSchedules } from "./schedules";

/**
 * Vault bridge for cloud agents with no API - Claude Duet, OpenAI Dots, or
 * anything that can read and write files in your OneDrive.
 *
 *   Agentic OS/Bridge/README.md   how to use the bridge (written for the agent)
 *   Agentic OS/Bridge/Status.md   what's running / waiting / broken, refreshed every 10 min
 *   Agentic OS/Bridge/Inbox/      the agent drops a task here (one .md file per task)
 *   Agentic OS/Bridge/Outbox/     the result comes back here, under the same file name
 *
 * Only the cluster MASTER processes the bridge, so a task runs exactly once.
 * By default every task becomes an approval first (Command -> Needs you, or
 * Telegram); turn that off only if you trust everything that can write to the
 * vault. The vault is the source of truth: a task's state lives in its Outbox
 * file, so the bridge survives a change of master. Settings are shared too
 * (Agentic OS/Cluster/bridge-settings.json).
 */

export interface BridgeSettings {
  enabled: boolean;
  /** each task needs your approval before it runs */
  requireApproval: boolean;
  /** cap on tasks accepted per day (protects your subscription) */
  dailyLimit: number;
  /** which Mission Control agent runs bridge tasks: "claude" or "auto" (smart router) */
  agent: "claude" | "auto";
}

const DEFAULTS: BridgeSettings = { enabled: true, requireApproval: true, dailyLimit: 20, agent: "claude" };
const STATUS_EVERY_MS = 10 * 60_000;
const SETTLE_MS = 15_000; // ignore inbox files still being written / synced
const MAX_BODY = 8_000;
const README_VERSION = 1;

// Test-only overrides: MC_BRIDGE_ROOT points the whole bridge (and its settings) at a scratch
// folder, MC_BRIDGE_FORCE=1 lets a non-master machine process it. Never set them in production.
const TEST_ROOT = process.env.MC_BRIDGE_ROOT;
export const bridgeDir = () => TEST_ROOT || path.join(vaultInfo().base, "Bridge");
const inboxDir = () => path.join(bridgeDir(), "Inbox");
const processedDir = () => path.join(bridgeDir(), "Inbox", "Processed");
const outboxDir = () => path.join(bridgeDir(), "Outbox");
const settingsFile = () => (TEST_ROOT ? path.join(TEST_ROOT, ".settings.json") : path.join(vaultInfo().base, "Cluster", "bridge-settings.json"));

export async function readBridgeSettings(): Promise<BridgeSettings> {
  try {
    const s = JSON.parse(await fsp.readFile(settingsFile(), "utf8")) as Partial<BridgeSettings>;
    return {
      enabled: typeof s.enabled === "boolean" ? s.enabled : DEFAULTS.enabled,
      requireApproval: typeof s.requireApproval === "boolean" ? s.requireApproval : DEFAULTS.requireApproval,
      dailyLimit: Number.isFinite(s.dailyLimit) ? Math.max(1, Math.min(200, Number(s.dailyLimit))) : DEFAULTS.dailyLimit,
      agent: s.agent === "auto" ? "auto" : "claude",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeBridgeSettings(patch: Partial<BridgeSettings>): Promise<BridgeSettings> {
  const next = { ...(await readBridgeSettings()), ...patch };
  await fsp.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

// ─── tiny frontmatter helpers ───

function parseNote(text: string): { meta: Record<string, string>; body: string } {
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: t.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

const yamlSafe = (v: string) => (/[:#"'\n]/.test(v) ? JSON.stringify(v) : v);

function note(meta: Record<string, string | undefined>, body: string): string {
  const fm = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${yamlSafe(String(v))}`)
    .join("\n");
  return `---\n${fm}\n---\n\n${body.trim()}\n`;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

// ─── README for the agents ───

function readmeText(): string {
  return `---
bridge-version: ${README_VERSION}
---

# Mission Control bridge

This folder connects AI agents that can read and write files here (Claude Duet,
OpenAI Dots, or any assistant with access to this OneDrive folder) to
**Mission Control**, the owner's AI operations dashboard. Mission Control runs
on the owner's own computers and Claude / ChatGPT subscriptions.

## 1. Read the current status

Open **Status.md** in this folder. Mission Control rewrites it every 10 minutes
with: what needs the owner, sessions running on each machine, health problems,
recent results, and scheduled jobs. The time it was written is at the top.

## 2. Send Mission Control a task

Create a new Markdown file in **Inbox/** - one file per task, any file name
ending in \`.md\` (for example \`2026-11-08 summarize-pipeline.md\`):

\`\`\`markdown
---
from: duet
title: Summarize this week's Velocity pipeline changes
---

What you want done, in plain language. Include any links, file paths
or context Mission Control needs. Keep it under ${MAX_BODY.toLocaleString()} characters.
\`\`\`

- \`from\` - who is asking (e.g. \`duet\`, \`dots\`). Optional.
- \`title\` - a short name for the task. Optional (the first line is used).
- Files whose name starts with \`_\` are ignored (use that for drafts).

## 3. Get the result

Mission Control writes **Outbox/<the same file name>** and keeps it updated.
Its \`status\` field moves through:

- \`awaiting-approval\` - the owner must approve it in Mission Control (or Telegram) first
- \`running\` - it's being worked on
- \`done\` - the answer is in the file
- \`failed\` / \`rejected\` / \`expired\` - the file says why

Check back every few minutes; most tasks finish within 5-15 minutes of approval.
The original task file moves to Inbox/Processed/.

## Rules

- Tasks run as a Mission Control mission on the owner's machines. They're
  meant for research, writing, summarizing and analysis - not for payments,
  sending messages, or deleting anything.
- There's a daily limit; extra tasks are rejected with a note in the Outbox.
- Don't edit Status.md or files in Outbox/ - Mission Control overwrites them.
`;
}

async function ensureScaffold(): Promise<void> {
  await fsp.mkdir(processedDir(), { recursive: true });
  await fsp.mkdir(outboxDir(), { recursive: true });
  const readme = path.join(bridgeDir(), "README.md");
  const cur = await fsp.readFile(readme, "utf8").catch(() => "");
  if (!cur.includes(`bridge-version: ${README_VERSION}`)) await writeAtomic(readme, readmeText());
}

// ─── inbox -> approval / mission -> outbox ───

interface TaskState {
  file: string; // outbox file
  meta: Record<string, string>;
  body: string;
}

async function listMd(dir: string): Promise<string[]> {
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n.toLowerCase().endsWith(".md") && !n.startsWith("_") && !n.startsWith("."));
}

function taskPrompt(from: string, title: string, body: string): string {
  return [
    `This task came to Mission Control through the vault bridge from ${from || "an external assistant"} (for example Claude Duet or an OpenAI Dot).`,
    "Do the task and reply with the finished result in Markdown - it is written back to the assistant that asked.",
    "Don't send messages, make payments or delete anything; if the task needs that, say what should be done instead.",
    "",
    `Task: ${title}`,
    "",
    body,
  ].join("\n");
}

async function acceptedToday(): Promise<number> {
  const since = Date.now() - 24 * 60 * 60_000;
  let n = 0;
  for (const f of await listMd(outboxDir())) {
    const st = await fsp.stat(path.join(outboxDir(), f)).catch(() => null);
    if (!st) continue;
    const { meta } = parseNote(await fsp.readFile(path.join(outboxDir(), f), "utf8").catch(() => ""));
    const t = Date.parse(meta.submitted ?? "");
    if (Number.isFinite(t) && t > since && meta.status !== "rejected") n++;
  }
  return n;
}

async function launch(task: TaskState, settings: BridgeSettings): Promise<void> {
  const title = task.meta.title || "Bridge task";
  const m = await startMission({
    title: `🌉 ${task.meta.from ? `${task.meta.from}: ` : ""}${title}`.slice(0, 90),
    prompt: taskPrompt(task.meta.from ?? "", title, task.body),
    strategy: "single",
    agentIds: [settings.agent],
  });
  task.meta.status = "running";
  task.meta.mission = m.id;
  task.meta.machine = os.hostname();
  task.meta.updated = new Date().toISOString();
  await writeAtomic(task.file, note(task.meta, `# ${title}\n\nRunning on ${os.hostname()} since ${new Date().toLocaleString()}. This file updates when it finishes.\n\n## Request\n\n${task.body}`));
}

async function intake(settings: BridgeSettings): Promise<number> {
  let taken = 0;
  for (const name of await listMd(inboxDir())) {
    const src = path.join(inboxDir(), name);
    const st = await fsp.stat(src).catch(() => null);
    if (!st || !st.isFile() || Date.now() - st.mtimeMs < SETTLE_MS) continue;
    const raw = await fsp.readFile(src, "utf8").catch(() => null);
    if (raw === null) continue;
    const { meta: inMeta, body } = parseNote(raw);
    const outFile = path.join(outboxDir(), name);
    const title = (inMeta.title || body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || name.replace(/\.md$/i, "")).slice(0, 120);
    const meta: Record<string, string> = {
      task: name.replace(/\.md$/i, ""),
      from: (inMeta.from || "").slice(0, 40),
      title,
      submitted: new Date().toISOString(),
      updated: new Date().toISOString(),
      status: "",
    };
    const reject = async (why: string) => {
      meta.status = "rejected";
      await writeAtomic(outFile, note(meta, `# ${title}\n\nNot run: ${why}`));
    };
    if (!settings.enabled) await reject("the Mission Control bridge is turned off.");
    else if (!body) await reject("the task file had no request text.");
    else if (body.length > MAX_BODY) await reject(`the request is longer than ${MAX_BODY} characters - shorten it and send it again.`);
    else if ((await acceptedToday()) >= settings.dailyLimit) await reject(`the daily limit of ${settings.dailyLimit} bridge tasks is reached - try again tomorrow.`);
    else {
      const task: TaskState = { file: outFile, meta, body };
      if (settings.requireApproval) {
        const ap = await createApproval({
          payload: `[Bridge · from ${meta.from || "assistant"}] ${title}\n\n${body}`,
          source: `bridge:${meta.from || "assistant"}`,
          handler: "bridge",
        });
        meta.status = "awaiting-approval";
        meta.approval = ap.id;
        await writeAtomic(outFile, note(meta, `# ${title}\n\nWaiting for the owner to approve it in Mission Control (approval ${ap.id}). This file updates when it runs.\n\n## Request\n\n${body}`));
      } else {
        await launch(task, settings);
      }
      taken++;
    }
    // move the request out of the inbox so it's never taken twice
    const done = path.join(processedDir(), /^\d{4}-\d{2}-\d{2}/.test(name) ? name : `${new Date().toISOString().slice(0, 10)} ${name}`);
    await fsp.rename(src, done).catch(async () => {
      await fsp.copyFile(src, done).catch(() => {});
      await fsp.unlink(src).catch(() => {});
    });
  }
  return taken;
}

async function advance(settings: BridgeSettings): Promise<void> {
  const approvals = await listApprovals().catch(() => []);
  const missions = await listMissions().catch(() => []);
  for (const name of await listMd(outboxDir())) {
    const file = path.join(outboxDir(), name);
    const { meta, body } = parseNote(await fsp.readFile(file, "utf8").catch(() => ""));
    const request = (body.split("## Request")[1] ?? "").trim();
    const title = meta.title || name;
    const updatedAt = Date.parse(meta.updated ?? "") || 0;
    if (meta.status === "awaiting-approval") {
      const ap = approvals.find((a) => a.id === meta.approval);
      if (ap?.status === "approved") await launch({ file, meta, body: request }, settings);
      else if (ap?.status === "rejected") {
        meta.status = "rejected";
        meta.updated = new Date().toISOString();
        await writeAtomic(file, note(meta, `# ${title}\n\nThe owner declined this task in Mission Control.\n\n## Request\n\n${request}`));
      } else if (!ap || Date.now() - updatedAt > 7 * 24 * 60 * 60_000) {
        meta.status = "expired";
        meta.updated = new Date().toISOString();
        await writeAtomic(file, note(meta, `# ${title}\n\nNo decision within 7 days, so it wasn't run. Send it again if it's still needed.\n\n## Request\n\n${request}`));
      }
    } else if (meta.status === "running") {
      const m = missions.find((x) => x.id === meta.mission);
      if (m && m.status !== "running") {
        const answer = m.synthesis?.trim() || m.results.find((r) => r.status === "done" && r.text.trim())?.text.trim() || "";
        const ok = m.status === "done" && answer;
        meta.status = ok ? "done" : "failed";
        meta.updated = new Date().toISOString();
        const why = m.synthesisError ?? m.results.find((r) => r.error)?.error ?? "the mission produced no answer";
        await writeAtomic(
          file,
          note(meta, ok ? `# ${title}\n\n## Result\n\n${answer}\n\n## Request\n\n${request}` : `# ${title}\n\nFailed: ${why}\n\n## Request\n\n${request}`),
        );
      } else if (!m && meta.machine === os.hostname() && Date.now() - updatedAt > 2 * 60 * 60_000) {
        meta.status = "failed";
        meta.updated = new Date().toISOString();
        await writeAtomic(file, note(meta, `# ${title}\n\nFailed: the run was lost (Mission Control restarted mid-task). Send it again.\n\n## Request\n\n${request}`));
      }
    }
  }
}

// ─── Status.md ───

const fmtTime = (ts?: number) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

async function machineHealth(): Promise<{ label: string; worst: string; issues: string[]; at: number }[]> {
  const dir = path.join(vaultInfo().base, "Cluster", "health");
  const out: { label: string; worst: string; issues: string[]; at: number }[] = [];
  const c = await clusterStatus().catch(() => null);
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    try {
      const r = JSON.parse(await fsp.readFile(path.join(dir, f), "utf8")) as { host: string; worst: string; checkedAt: number; checks: { level: string; label: string; detail: string }[] };
      const label = c?.nodes.find((n) => n.host === r.host)?.label ?? r.host;
      out.push({ label, worst: r.worst, at: r.checkedAt, issues: r.checks.filter((x) => x.level === "fail" || x.level === "warn").map((x) => `${x.label}: ${x.detail}`) });
    } catch {
      /* skip */
    }
  }
  return out;
}

async function writeStatus(): Promise<void> {
  const [hub, health, schedules, approvals, cfg] = await Promise.all([
    hubSnapshot(),
    machineHealth(),
    listSchedules().catch(() => []),
    listApprovals().catch(() => []),
    readConfig().catch(() => null),
  ]);
  const label = (host: string) => hub.machines.find((m) => m.host === host)?.label ?? (host === hub.host ? cfg?.label || host : host);
  const pending = approvals.filter((a) => a.status === "pending");
  const waiting = hub.sessions.filter((s) => s.status === "waiting");
  const running = hub.sessions.filter((s) => s.status === "running");
  const day = Date.now() - 24 * 60 * 60_000;
  const recent = hub.items.filter((i) => (i.source === "mission" || i.source === "orchestration") && i.ts > day).slice(0, 12);

  const lines: string[] = [
    "---",
    `updated: ${new Date().toISOString()}`,
    `by: ${yamlSafe(cfg?.label || os.hostname())}`,
    "---",
    "",
    "# Mission Control status",
    "",
    `_Written ${fmtTime(Date.now())} by ${cfg?.label || os.hostname()} (the master machine). Refreshed every 10 minutes. To send a task, see README.md._`,
    "",
    "## Needs the owner",
    "",
  ];
  if (!pending.length && !waiting.length && !hub.attention.length) lines.push("- Nothing is waiting on the owner.");
  for (const a of pending.slice(0, 10)) lines.push(`- Approval ${a.id} (${a.source}): ${a.payload.split("\n")[0].slice(0, 140)}`);
  for (const s of waiting.slice(0, 10)) lines.push(`- ${s.tool === "claude" ? "Claude Code" : "Codex"} session waiting on ${label(s.host)}: "${s.title}" (${s.project})`);
  for (const a of hub.attention.filter((x) => x.kind !== "approval").slice(0, 8)) lines.push(`- ${a.label}: ${a.detail}`);

  lines.push("", "## Running now", "");
  if (!running.length) lines.push("- No AI sessions are running right now.");
  for (const s of running.slice(0, 15)) lines.push(`- ${label(s.host)} · ${s.tool === "claude" ? "Claude Code" : "Codex"} · ${s.project}: "${s.title}" (since ${fmtTime(s.startedAt)})`);

  lines.push("", "## Machine health", "");
  if (!health.length) lines.push("- No health reports yet.");
  for (const h of health) {
    lines.push(`- **${h.label}**: ${h.issues.length ? `${h.issues.length} issue(s)` : "all checks passing"} (checked ${fmtTime(h.at)})`);
    for (const i of h.issues.slice(0, 5)) lines.push(`  - ${i.slice(0, 200)}`);
  }

  lines.push("", "## Results in the last 24 hours", "");
  if (!recent.length) lines.push("- No missions finished in the last 24 hours.");
  for (const r of recent) lines.push(`- ${fmtTime(r.ts)} · ${r.status === "error" ? "FAILED" : r.status === "done" ? "done" : r.status} · ${r.title.slice(0, 120)}`);

  lines.push("", "## Scheduled jobs", "");
  if (!schedules.length) lines.push("- None on this machine.");
  for (const s of schedules) lines.push(`- ${s.title}: ${s.enabled ? `next ${fmtTime(s.nextRun)}` : "paused"} · last run ${fmtTime(s.lastRun)}${s.lastStatus ? ` (${s.lastStatus.slice(0, 100)})` : ""}`);

  const projects = new Map<string, number>();
  for (const s of hub.sessions.filter((x) => x.updatedAt > Date.now() - 7 * 24 * 60 * 60_000)) projects.set(s.project, (projects.get(s.project) ?? 0) + 1);
  lines.push("", "## Active projects (last 7 days)", "");
  if (!projects.size) lines.push("- No sessions in the last 7 days.");
  for (const [p, n] of [...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) lines.push(`- ${p}: ${n} session${n === 1 ? "" : "s"}`);

  await writeAtomic(path.join(bridgeDir(), "Status.md"), lines.join("\n") + "\n");
}

// ─── tick + status for the UI ───

let ticking: Promise<void> | null = null;
let lastStatusAt = 0;

/** Master-only, every scheduler tick (30s): intake + advance every minute, Status.md every 10. */
export function bridgeTick(force = false): Promise<void> {
  if (ticking) return ticking;
  ticking = (async () => {
    if (!(await vaultAvailable())) return;
    if (process.env.MC_BRIDGE_FORCE !== "1" && !(await isMasterNow().catch(() => false))) return;
    const settings = await readBridgeSettings();
    await ensureScaffold();
    await intake(settings);
    await advance(settings);
    const st = await fsp.stat(path.join(bridgeDir(), "Status.md")).catch(() => null);
    const last = Math.max(lastStatusAt, st?.mtimeMs ?? 0);
    if (force || Date.now() - last > STATUS_EVERY_MS) {
      await writeStatus();
      lastStatusAt = Date.now();
    }
  })()
    .catch(() => {})
    .finally(() => {
      ticking = null;
    });
  return ticking;
}

export interface BridgeView {
  folder: string;
  settings: BridgeSettings;
  master: string | null;
  isMaster: boolean;
  statusUpdatedAt?: number;
  inboxWaiting: number;
  tasks: { file: string; title: string; from: string; status: string; updated: number; approval?: string }[];
}

export async function bridgeView(): Promise<BridgeView> {
  const [settings, c, master] = await Promise.all([readBridgeSettings(), clusterStatus().catch(() => null), isMasterNow().catch(() => false)]);
  const st = await fsp.stat(path.join(bridgeDir(), "Status.md")).catch(() => null);
  const tasks: BridgeView["tasks"] = [];
  for (const f of await listMd(outboxDir())) {
    const { meta } = parseNote(await fsp.readFile(path.join(outboxDir(), f), "utf8").catch(() => ""));
    tasks.push({ file: f, title: meta.title || f, from: meta.from || "", status: meta.status || "?", updated: Date.parse(meta.updated ?? "") || 0, approval: meta.approval });
  }
  tasks.sort((a, b) => b.updated - a.updated);
  return {
    folder: bridgeDir(),
    settings,
    master: c?.master ?? null,
    isMaster: master || process.env.MC_BRIDGE_FORCE === "1",
    statusUpdatedAt: st?.mtimeMs,
    inboxWaiting: (await listMd(inboxDir())).length,
    tasks: tasks.slice(0, 20),
  };
}
