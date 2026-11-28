import { buildBoard } from "@/lib/board";

export const dynamic = "force-dynamic";

/**
 * The live board (lib/board.ts): everything the fleet is doing or waiting on, as one list.
 * GET            → { at, items[], counts{waiting,pending,running,done,failed}, machines[], yours, notes[] }
 * GET ?count=1   → { waiting, running }  (the top bar's chip)
 * Each item carries its own action buttons (calls to the API its page already uses).
 */
let cache: { at: number; board: Awaited<ReturnType<typeof buildBoard>> } | null = null;
export async function GET(req: Request) {
  try {
    if (!cache || Date.now() - cache.at > 4000) cache = { at: Date.now(), board: await buildBoard() };
    const b = cache.board;
    if (new URL(req.url).searchParams.get("count") === "1") return Response.json({ waiting: b.counts.waiting, running: b.counts.running });
    return Response.json(b);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
