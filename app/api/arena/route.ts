import { listStandings, recordVote } from "@/lib/arena";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ standings: await listStandings() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { winner?: string; participants?: string[]; prompt?: string };
  const winner = (body.winner ?? "").toString();
  const participants = (body.participants ?? []).filter((p) => typeof p === "string").slice(0, 4);
  if (!winner || participants.length < 2 || !participants.includes(winner)) {
    return Response.json({ error: "winner must be one of 2+ participants" }, { status: 400 });
  }
  await recordVote(winner, participants, (body.prompt ?? "").toString());
  return Response.json({ ok: true });
}
