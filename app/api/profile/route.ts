import { readUserProfile } from "@/lib/vault";
import { refreshUserProfile, readProfileState, PROFILE_MAX_CHARS } from "@/lib/userProfile";

export const dynamic = "force-dynamic";
// A refresh runs a real writer pass over chats + goals + tasks + journal,
// plus a compression pass if it overruns the cap.
export const maxDuration = 180;

export async function GET() {
  const [note, state] = await Promise.all([readUserProfile(), readProfileState()]);
  return Response.json({
    exists: Boolean(note.trim()),
    note,
    maxChars: PROFILE_MAX_CHARS,
    lastRun: state.lastRun ?? null,
    lastStatus: state.lastStatus ?? null,
    writer: state.writer ?? "claude",
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { writer?: string };
  const result = await refreshUserProfile((body.writer || "claude").trim());
  if (!result.ok) return Response.json({ error: result.error, sources: result.sources }, { status: 500 });
  return Response.json(result);
}
