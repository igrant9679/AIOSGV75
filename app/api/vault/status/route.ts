import { vaultAvailable, vaultInfo } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: await vaultAvailable(), ...vaultInfo() });
}
