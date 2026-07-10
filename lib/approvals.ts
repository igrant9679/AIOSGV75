import fs from "fs/promises";
import path from "path";
import { startMission } from "./missions";
import { sendTelegram } from "./telegram";

/**
 * Server-side approval gate for agent-requested actions. Pending approvals
 * can be resolved from the dashboard (ApprovalsBar) or from Telegram — the
 * OpenClaw agent knows the protocol (see its TOOLS.md) and PATCHes
 * /api/approvals when the owner replies "approve <id>" / "reject <id>".
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
}

const FILE = path.join(process.cwd(), "data", "approvals.json");
const MAX_KEPT = 200;

async function load(): Promise<Approval[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Approval[];
  } catch {
    return [];
  }
}

async function save(approvals: Approval[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(approvals.slice(-MAX_KEPT), null, 2), "utf8");
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
  };
  approvals.push(approval);
  await save(approvals);

  // notify the owner's phone — fire and forget
  void sendTelegram(
    `🚦 Approval needed [${approval.id}]\n\n${approval.source} wants to launch a background mission:\n"${approval.payload.slice(0, 400)}"\n\nReply "approve ${approval.id}" or "reject ${approval.id}" — or use the dashboard.`,
  );
  return approval;
}

/** Idempotent: resolving an already-resolved approval returns it unchanged. */
export async function resolveApproval(id: string, approve: boolean, by: string): Promise<Approval | null> {
  const approvals = await load();
  const approval = approvals.find((a) => a.id === id);
  if (!approval) return null;
  if (approval.status !== "pending") return approval;

  approval.status = approve ? "approved" : "rejected";
  approval.resolvedBy = by.slice(0, 30);
  approval.resolvedAt = Date.now();
  await save(approvals);

  if (approve) {
    await startMission({
      title: `🤖 via ${approval.source} (approved): ${approval.payload.slice(0, 40)}`,
      prompt: approval.payload,
      strategy: "single",
      agentIds: ["claude"],
    });
  }
  return approval;
}
