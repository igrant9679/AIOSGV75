import { readUserProfile } from "@/lib/vault";
import { refreshUserProfile, PROFILE_MAX_CHARS } from "@/lib/userProfile";

export const dynamic = "force-dynamic";
// A refresh runs a real writer pass over chats + goals + tasks + journal.
export const maxDuration = 120;

export async function GET() {
  const note = await readUserProfile();
  return Response.json({ exists: Boolean(note.trim()), note, maxChars: PROFILE_MAX_CHARS });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { writer?: string };
  const result = await refreshUserProfile((body.writer || "claude").trim());
  if (!result.ok) return Response.json({ error: result.error, sources: result.sources }, { status: 500 });
  return Response.json(result);
}
