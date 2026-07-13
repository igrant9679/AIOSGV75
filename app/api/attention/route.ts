import { collectAttention } from "@/lib/attention";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ items: await collectAttention() });
}
