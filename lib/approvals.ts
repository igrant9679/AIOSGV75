import fs from "fs/promises";
import path from "path";
import { startMission } from "./missions";
import { sendTelegram } from "./telegram";
import { vaultInfo } from "./vault";

/**
 * Server-side approval gate for agent-requested actions.
 *
 * **Stored in the vault** (`Agentic OS/Approvals.json`), not `data/`, so the
 * whole fleet shares one queue. Previously this lived in per-machine
 * `data/approvals.json`, which meant OpenClaw's gateway — it curls its OWN
 * `127.0.0.1:3000` — could only ever action approvals raised on the machine it
 * ran on. With the cluster master on one box and the gateway on another, an
 * approval raised by a schedule simply could not be answered from Telegram; it
 * sat pending until it timed out. Vault-backing removes that coupling, the same
 * way `lib/tasks.ts` vault-backs the kanban board.
 *
 * Two consequences that shaped the code:
 *  - Several machines may write this file (OneDrive, eventually consistent), so
 *    saves MERGE by id rather than blind-overwriting the array.
 *  - Resolving no longer launches the mission inline. The resolver might be any
 *    machine — including a workstation with no schedules. `syncApprovedMissions()`
 *    runs on the MASTER's tick and launches approved-but-unlaunched items, so the
 *    work lands where the fleet's other background duties run.
 */
export interface Approval {
  id: string;
  kind: "mission";
  payload: string;
  source: string;
  ts: number;
  status: "pending" | "approved" | "rejected";
  resolvedBy?: string;
  resolvedAt?: number;
  /** Set by the master once the mission has actually been started. */
  launchedAt?: number;
  /** Host that raised it — useful when debugging a multi-machine queue. */
  origin?: string;
}

const LEGACY_FILE = path.join(process.cwd(), "data", "approvals.json");
const MAX_KEPT = 200;

function approvalsFile(): string {
  return path.join(vaultInfo().base, "Approvals.json");
}

async function readFile(file: string): Promise<Approval[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Approval[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function load(): Promise<Approval[]> {
  const vaultRows = await readFile(approvalsFile());
  if (vaultRows.length > 0) return vaultRows;
  // One-time migration: adopt whatever this machine had locally. Harmless to
  // repeat — ids are stable, so a second machine migrating merges cleanly.
  const legacy = await readFile(LEGACY_FILE);
  if (legacy.length === 0) return legacy;
  // Legacy rows predate `launchedAt` (the old code launched inline on resolve).
  // Without this, every already-approved row looks like it still needs starting
  // and the master would re-run months-old missions the moment it migrated.
  const migrated = legacy.map((a) =>
    a.status === "approved" && !a.launchedAt ? { ...a, launchedAt: a.resolvedAt ?? a.ts } : a,
  );
  await save(migrated);
  return migrated;
}

/**
 * Merge-on-write. Re-reads immediately before writing and unions by id, with
 * the caller's version winning for rows it touched. Without this, two machines
 * doing read-modify-write seconds apart would silently drop each other's rows.
 */
async function save(mine: Approval[]): Promise<void> {
  const file = approvalsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const current = await readFile(file);
  const byId = new Map<string, Approval>();
  for (const a of current) byId.set(a.id, a);
  for (const a of mine) {
    const existing = byId.get(a.id);
    // Never let a stale in-memory copy un-resolve something another machine
    // already decided — resolution is one-way.
    if (existing && existing.status !== "pending" && a.status === "pending") continue;
    // …and launching is one-way too. If another machine already stamped
    // launchedAt, a stale copy without it must not clear the stamp, or the
    // master's next tick would start the same mission a second time.
    byId.set(a.id, existing?.launchedAt && !a.launchedAt ? { ...a, launchedAt: existing.launchedAt } : a);
  }
  const merged = [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-MAX_KEPT);
  await fs.writeFile(file, JSON.stringify(merged, null, 2), "utf8");
}

export async function listApprovals(): Promise<Approval[]> {
  return load();
}

let seq = 0;

export async function createApproval(input: { payload: string; source: string }): Promise<Approval> {
  const approvals = await load();
  const approval: Approval = {
    id: `ap-${Date.now().toString(36)}${seq++}`,
    kind: "mission",
    payload: input.payload.slice(0, 2000),
    source: input.source.slice(0, 40),
    ts: Date.now(),
    status: "pending",
    origin: (await import("os")).hostname(),
  };
  approvals.push(approval);
  await save(approvals);

  // notify the owner's phone — fire and forget
  void sendTelegram(
    `🚦 Approval needed [${approval.id}]\n\n${approval.source} wants to launch a background mission:\n"${approval.payload.slice(0, 400)}"\n\nReply "approve ${approval.id}" or "reject ${approval.id}" — or use the dashboard.`,
  );
  return approval;
}

/**
 * Idempotent: resolving an already-resolved approval returns it unchanged.
 * Does NOT launch the mission — see syncApprovedMissions().
 */
export async function resolveApproval(id: string, approve: boolean, by: string): Promise<Approval | null> {
  const approvals = await load();
  const approval = approvals.find((a) => a.id === id);
  if (!approval) return null;
  if (approval.status !== "pending") return approval;

  approval.status = approve ? "approved" : "rejected";
  approval.resolvedBy = by.slice(0, 30);
  approval.resolvedAt = Date.now();
  await save(approvals);
  return approval;
}

/**
 * Master-only: start missions for approvals that were approved anywhere in the
 * fleet but not yet launched. Called from the scheduler tick, behind the same
 * cluster gate as the other master duties, so exactly one machine launches.
 */
/** An approval older than this is never auto-launched — see below. */
const LAUNCH_WINDOW_MS = 60 * 60 * 1000;

export async function syncApprovedMissions(): Promise<void> {
  const approvals = await load();
  const now = Date.now();
  const due = approvals.filter(
    (a) =>
      a.status === "approved" &&
      !a.launchedAt &&
      // Belt-and-braces against resurrection. Any future path that loses
      // `launchedAt` — a bad merge, a hand-edited vault file, a restored backup
      // — would otherwise make the master re-run every approval it ever
      // granted. An approval nobody launched within an hour is dead, not due.
      now - (a.resolvedAt ?? a.ts) < LAUNCH_WINDOW_MS,
  );
  if (due.length === 0) return;

  for (const approval of due) {
    // Stamp BEFORE starting: a crash mid-launch must not leave an approval that
    // re-fires the same mission on every subsequent 30s tick.
    approval.launchedAt = Date.now();
  }
  await save(approvals);

  for (const approval of due) {
    await startMission({
      title: `🤖 via ${approval.source} (approved): ${approval.payload.slice(0, 40)}`,
      prompt: approval.payload,
      strategy: "single",
      agentIds: ["claude"],
    }).catch(() => {});
  }
}
