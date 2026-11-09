import { searchFleet } from "@/lib/sessionSearch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?q= → hits in the full threads of every session on every machine. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  try {
    return Response.json(await searchFleet(q));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
