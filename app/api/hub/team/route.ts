import { listJobs } from "@/lib/sessionActions";
import { clearChannel, post, readTeam, removeMember, resetMember, saveMember, type MemberInput } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Command → Team (lib/team.ts).
 * GET  → { members, messages, progress: { [jobId]: { status, text, steps, waitReason } } }
 * POST { action: "post", text }
 *      { action: "member", member: { id?, name, role, tool, agent?, host, folder, project?, access } }
 *      { action: "remove" | "reset", id }
 *      { action: "clear" }
 */
export async function GET() {
  try {
    const [team, jobs] = await Promise.all([readTeam(), listJobs()]);
    const open = new Set(team.messages.filter((m) => m.jobId && (m.status === "waiting" || m.status === "working")).map((m) => m.jobId!));
    const progress = Object.fromEntries(
      jobs.filter((j) => open.has(j.id)).map((j) => [j.id, { status: j.status, text: j.progress?.text?.slice(-1500) ?? "", steps: j.progress?.steps.slice(-6) ?? [], waitReason: j.waitReason, hostLabel: j.hostLabel }]),
    );
    return Response.json({ ...team, progress });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let b: { action?: string; text?: string; id?: string; member?: MemberInput };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    switch (b.action) {
      case "post":
        return Response.json({ sent: await post(String(b.text ?? "")) });
      case "member":
        return Response.json({ member: await saveMember(b.member ?? {}) });
      case "remove":
        if (b.id) await removeMember(b.id);
        return Response.json({ ok: true });
      case "reset":
        if (b.id) await resetMember(b.id);
        return Response.json({ ok: true });
      case "clear":
        await clearChannel();
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
