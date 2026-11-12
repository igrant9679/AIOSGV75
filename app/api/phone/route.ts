import { lanAddresses, PEER_PORT } from "@/lib/netAddrs";
import { peerListening } from "@/lib/peer";
import { phoneStatus, setPhoneAccess } from "@/lib/phoneAccess";

export const dynamic = "force-dynamic";

/** Phone access on this machine (lib/phoneAccess.ts): status + the addresses to open on a phone. */
export async function GET() {
  return Response.json({
    ...phoneStatus(),
    port: PEER_PORT,
    listening: await peerListening(),
    urls: lanAddresses().map((a) => `http://${a}:${PEER_PORT}/`),
  });
}

/** { enabled?, pin?, signOutAll?, removeDevice? } */
export async function POST(req: Request) {
  let b: { enabled?: unknown; pin?: unknown; signOutAll?: unknown; removeDevice?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const st = await setPhoneAccess({
      enabled: typeof b.enabled === "boolean" ? b.enabled : undefined,
      pin: typeof b.pin === "string" ? b.pin : undefined,
      signOutAll: b.signOutAll === true,
      removeDevice: typeof b.removeDevice === "string" ? b.removeDevice : undefined,
    });
    return Response.json({ ...st, port: PEER_PORT, listening: await peerListening(), urls: lanAddresses().map((a) => `http://${a}:${PEER_PORT}/`) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: (e as { status?: number }).status ?? 500 });
  }
}
