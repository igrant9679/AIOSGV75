import { searchConversations, conversationsAvailable, summarizeIds } from "@/lib/conversations";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const [results, vaultOk] = await Promise.all([
    searchConversations({
      q: url.searchParams.get("q") ?? "",
      agent: url.searchParams.get("agent") ?? undefined,
      host: url.searchParams.get("host") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
      group: url.searchParams.get("group") === "session" ? "session" : "exchange",
    }),
    conversationsAvailable(),
  ]);
  return Response.json({ ...results, vaultOk });
}

/** POST { ids, group, agent } — generate + cache one-line AI summaries. */
export async function POST(request: Request) {
  const body = (await request.json()) as { ids?: string[]; group?: "exchange" | "session"; agent?: string };
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 12) : [];
  if (!ids.length) return Response.json({ error: "ids required" }, { status: 400 });
  const summaries = await summarizeIds(ids, body.group === "session" ? "session" : "exchange", body.agent || "auto");
  return Response.json({ summaries });
}
