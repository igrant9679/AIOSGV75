import os from "os";
import { clusterStatus } from "@/lib/cluster";
import { lanAddresses, PEER_PORT } from "@/lib/netAddrs";
import { modeOf, peerListening, probePeer, readNetwork, setHostNetwork, type NetMode } from "@/lib/peer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function view(probe: boolean) {
  const [net, st] = await Promise.all([readNetwork(), clusterStatus()]);
  const others = st.nodes.filter((n) => !n.self);
  const probes = probe ? await Promise.all(others.map((n) => (modeOf(net, n.host) === "offlan" ? Promise.resolve(null) : probePeer(n.host)))) : others.map(() => null);
  return {
    self: { host: os.hostname(), label: st.config.label, addrs: lanAddresses(), port: PEER_PORT, listening: await peerListening() },
    clusterOn: st.config.enabled,
    machines: others.map((n, i) => {
      const k = Object.keys(net.hosts).find((h) => h.toLowerCase() === n.host.toLowerCase());
      return {
        host: n.host,
        label: n.label,
        online: n.online,
        mode: modeOf(net, n.host),
        address: k ? net.hosts[k].address ?? "" : "",
        lanAddrs: (n as { lanAddrs?: string[] }).lanAddrs ?? [],
        probe: probes[i],
      };
    }),
  };
}

/** GET [?probe=1] → this machine's LAN listener + every other machine's mode, address and reachability. */
export async function GET(req: Request) {
  try {
    return Response.json(await view(new URL(req.url).searchParams.get("probe") === "1"));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** { host, mode?: "lan" | "offlan" | "auto", address?: string } - shared with every machine through the vault. */
export async function POST(req: Request) {
  let b: { host?: string; mode?: string; address?: string };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (!b.host || !/^[\w.-]{1,80}$/.test(b.host)) return Response.json({ error: "bad host" }, { status: 400 });
    await setHostNetwork(b.host, { mode: b.mode as NetMode | undefined, address: typeof b.address === "string" ? b.address : undefined });
    return Response.json(await view(true));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
