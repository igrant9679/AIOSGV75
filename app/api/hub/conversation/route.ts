import { readConfig } from "@/lib/cluster";
import { sessionsSnapshot } from "@/lib/sessions";
import { mergeRemoteSessions, readRemoteSessions } from "@/lib/sessionShare";
import { conversationFor } from "@/lib/sessionDigest";

export const dynamic = "force-dynamic";

/**
 * GET ?key=claude:<id> — a session's conversation (your messages + replies,
 * no tool output, secrets redacted) as Markdown. Built live when the session
 * is on this machine; read from the vault digest when it's on another one.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!/^(claude|codex):[\w-]+$/.test(key)) return Response.json({ error: "bad key" }, { status: 400 });
  try {
    const snap = await sessionsSnapshot();
    const { sessions } = await mergeRemoteSessions(snap.sessions);
    const s = sessions.find((x) => x.key === key);
    if (!s) return Response.json({ error: "session not found" }, { status: 404 });
    const cfg = await readConfig().catch(() => null);
    const remote = s.host === snap.host ? null : (await readRemoteSessions()).find((f) => f.host === s.host);
    const label = remote?.label ?? (s.host === snap.host ? cfg?.label || s.host : s.host);
    const conv = await conversationFor(s, label);
    if (!conv) {
      return Response.json(
        { error: `No conversation shared yet — ${label} publishes conversations every 5 minutes when sharing is on there.` },
        { status: 404 },
      );
    }
    // the UI shows its own header; drop the note's frontmatter
    return Response.json({ markdown: conv.markdown.replace(/^---[\s\S]*?\n---\n+/, ""), source: conv.source, machine: label });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
