import { listApprovals, createApproval, resolveApproval, syncApprovedMissions } from "@/lib/approvals";
import { isMasterNow } from "@/lib/cluster";

export const dynamic = "force-dynamic";

export async function GET() {
  const all = await listApprovals();
  return Response.json({
    pending: all.filter((a) => a.status === "pending"),
    recent: all.filter((a) => a.status !== "pending").slice(-10),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { payload?: string; source?: string };
  const payload = (body.payload ?? "").toString().trim();
  if (!payload) return Response.json({ error: "payload required" }, { status: 400 });
  const approval = await createApproval({ payload, source: (body.source ?? "agent").toString() });
  return Response.json({ ok: true, id: approval.id });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; approve?: boolean; by?: string };
  if (!body.id || typeof body.approve !== "boolean") {
    return Response.json({ error: "id and approve required" }, { status: 400 });
  }
  const approval = await resolveApproval(body.id, body.approve, (body.by ?? "dashboard").toString());
  if (!approval) return Response.json({ error: "not found" }, { status: 404 });
  // Launching is the master's job, but if THIS machine is the master there's no
  // reason to make the user wait up to 30s for the next tick — approving in the
  // dashboard should feel immediate. Elsewhere the tick picks it up.
  if (approval.status === "approved" && (await isMasterNow().catch(() => false))) {
    void syncApprovedMissions().catch(() => {});
  }
  return Response.json({ ok: true, status: approval.status, resolvedBy: approval.resolvedBy });
}
