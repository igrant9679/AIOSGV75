import { conversationAnalytics, conversationsAvailable } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET() {
  const [analytics, vaultOk] = await Promise.all([conversationAnalytics(), conversationsAvailable()]);
  return Response.json({ ...analytics, vaultOk });
}
