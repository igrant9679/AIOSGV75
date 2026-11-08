import { hubSnapshot } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** One snapshot for the second-brain pages: activity, sessions, meters, attention. */
export async function GET() {
  try {
    return Response.json(await hubSnapshot());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
