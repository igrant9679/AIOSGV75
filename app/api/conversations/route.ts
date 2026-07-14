import { searchConversations, conversationsAvailable } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const [results, vaultOk] = await Promise.all([
    searchConversations({
      q: url.searchParams.get("q") ?? "",
      agent: url.searchParams.get("agent") ?? undefined,
      host: url.searchParams.get("host") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
    }),
    conversationsAvailable(),
  ]);
  return Response.json({ ...results, vaultOk });
}
