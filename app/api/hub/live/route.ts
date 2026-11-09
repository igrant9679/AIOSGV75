import { fleetLive } from "@/lib/fleetLive";

export const dynamic = "force-dynamic";

/** What every open session on every machine is doing right now. */
export async function GET() {
  try {
    return Response.json(await fleetLive());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
