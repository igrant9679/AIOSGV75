import { searchVault } from "@/lib/vaultSearch";
import { vaultAvailable } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ results: [] });
  const results = await searchVault(q.slice(0, 300), 8);
  return Response.json({ results });
}
