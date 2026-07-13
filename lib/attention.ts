import fs from "fs/promises";
import path from "path";
import { listApprovals } from "./approvals";
import { listMissions } from "./missions";
import { listSchedules } from "./schedules";
import { sendTelegram } from "./telegram";

/**
 * "Needs Attention" aggregator: everything currently blocked on the owner or
 * gone wrong, in one list — pending approvals (with age), errored missions,
 * suspiciously long-running missions, and schedules whose last run failed.
 * The scheduler tick also nudges Telegram once per approval that has sat
 * unanswered for over ten minutes.
 */
export interface AttentionItem {
  kind: "approval" | "mission_error" | "mission_stalled" | "schedule_failed";
  id: string;
  label: string;
  detail: string;
  ts: number;
}

const STALL_MS = 10 * 60_000;
const ERROR_WINDOW_MS = 24 * 60 * 60_000;
const NUDGE_AFTER_MS = 10 * 60_000;
const NUDGE_FILE = path.join(process.cwd(), "data", "attention-nudges.json");

export async function collectAttention(): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];
  const now = Date.now();

  const approvals = await listApprovals().catch(() => []);
  for (const a of approvals) {
    if (a.status !== "pending") continue;
    items.push({
      kind: "approval",
      id: a.id,
      label: `Approval waiting · ${a.source}`,
      detail: a.payload.slice(0, 120),
      ts: a.ts,
    });
  }

  const missions = await listMissions().catch(() => []);
  for (const m of missions) {
    if (m.status === "error" && (m.finishedAt ?? m.createdAt) > now - ERROR_WINDOW_MS) {
      items.push({
        kind: "mission_error",
        id: m.id,
        label: `Mission failed · ${m.title.slice(0, 50)}`,
        detail: m.synthesisError ?? m.results.find((r) => r.error)?.error ?? "one or more agents errored",
        ts: m.finishedAt ?? m.createdAt,
      });
    } else if (m.status === "running" && now - m.createdAt > STALL_MS) {
      items.push({
        kind: "mission_stalled",
        id: m.id,
        label: `Mission running ${Math.round((now - m.createdAt) / 60_000)}m · ${m.title.slice(0, 50)}`,
        detail: "unusually long — possibly stalled (auto-marked failed at 30m)",
        ts: m.createdAt,
      });
    }
  }

  const schedules = await listSchedules().catch(() => []);
  for (const s of schedules) {
    if (s.enabled && s.lastStatus && /error|fail/i.test(s.lastStatus)) {
      items.push({
        kind: "schedule_failed",
        id: s.id,
        label: `Schedule last run failed · ${s.title.slice(0, 50)}`,
        detail: s.lastStatus.slice(0, 120),
        ts: s.lastRun ?? s.nextRun,
      });
    }
  }

  return items.sort((a, b) => b.ts - a.ts);
}

/** Telegram reminder, once per approval, after it has sat pending 10+ minutes. */
export async function nudgeStaleApprovals(): Promise<void> {
  const approvals = await listApprovals().catch(() => []);
  const pending = approvals.filter((a) => a.status === "pending" && Date.now() - a.ts > NUDGE_AFTER_MS);
  if (pending.length === 0) return;

  let nudged: Record<string, number> = {};
  try {
    nudged = JSON.parse(await fs.readFile(NUDGE_FILE, "utf8")) as Record<string, number>;
  } catch {
    /* first nudge */
  }

  let dirty = false;
  for (const a of pending) {
    if (nudged[a.id]) continue;
    const mins = Math.round((Date.now() - a.ts) / 60_000);
    await sendTelegram(
      `⏳ Still waiting (${mins}m): approval ${a.id} from ${a.source}\n"${a.payload.slice(0, 200)}"\n\nReply "approve ${a.id}" or "reject ${a.id}".`,
    ).catch(() => {});
    nudged[a.id] = Date.now();
    dirty = true;
  }

  if (dirty) {
    // prune resolved ids so the file can't grow unbounded
    const pendingIds = new Set(approvals.filter((a) => a.status === "pending").map((a) => a.id));
    for (const id of Object.keys(nudged)) if (!pendingIds.has(id)) delete nudged[id];
    await fs.mkdir(path.dirname(NUDGE_FILE), { recursive: true });
    await fs.writeFile(NUDGE_FILE, JSON.stringify(nudged), "utf8");
  }
}
