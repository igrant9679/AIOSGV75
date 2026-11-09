import os from "os";

/** Port of the LAN peer listener (lib/peer.ts). The app UI itself stays on 127.0.0.1:3000. */
export const PEER_PORT = Number(process.env.MC_PEER_PORT) || 3101;

const VIRTUAL = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|docker|vboxnet|utun|llw|awdl|bridge|Tailscale|ZeroTier|Npcap/i;

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

/**
 * This machine's LAN IPv4 addresses, real adapters first (Wi-Fi / Ethernet),
 * private ranges first. Published in the cluster heartbeat so the other
 * machines know where to reach this one.
 */
export function lanAddresses(): string[] {
  const out: { ip: string; rank: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      const virtual = VIRTUAL.test(name);
      out.push({ ip: a.address, rank: (virtual ? 2 : 0) + (isPrivate(a.address) ? 0 : 1) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.ip);
}
