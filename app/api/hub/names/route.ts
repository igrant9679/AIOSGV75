import { sessionsSnapshot } from "@/lib/sessions";
import { aiNameSessions, needsNaming, readNames, renameSessions } from "@/lib/sessionNaming";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Naming status: how many sessions still need a name, and the last AI run. */
export async function GET() {
  try {
    const [snap, names] = await Promise.all([sessionsSnapshot(), readNames()]);
    return Response.json({ needsNaming: snap.sessions.filter(needsNaming).length, lastAiRun: names.lastAiRun ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "rename", keys: string[], title?: string, project?: string }
 *   — your rename ("" resets to the automatic name)
 * { action: "ai" } — one Haiku run on your Claude subscription that groups
 *   unsorted sessions and renames ones whose title is really a prompt
 */
export async function POST(req: Request) {
  let body: { action?: string; keys?: unknown; title?: unknown; project?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "rename") {
      const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === "string" && /^(claude|codex):/.test(k)).slice(0, 500) : [];
      if (keys.length === 0) return Response.json({ error: "no sessions given" }, { status: 400 });
      const title = typeof body.title === "string" ? body.title : undefined;
      const project = typeof body.project === "string" ? body.project : undefined;
      if (title === undefined && project === undefined) return Response.json({ error: "nothing to rename" }, { status: 400 });
      await renameSessions(keys, { title, project });
      return Response.json({ ok: true, renamed: keys.length });
    }
    if (body.action === "ai") {
      const snap = await sessionsSnapshot();
      const result = await aiNameSessions(snap.sessions);
      return Response.json({ ok: !result.error, ...result }, { status: result.error && result.named === 0 ? 502 : 200 });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
