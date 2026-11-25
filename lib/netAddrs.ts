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

const toInt = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + (Number(o) & 255), 0) >>> 0;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** The networks this machine's real adapters are on, as "192.168.4.0/22". */
export function localNetworks(): { net: number; bits: number; label: string }[] {
  const out: { net: number; bits: number; label: string }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.") || !a.cidr) continue;
      const bits = Number(a.cidr.split("/")[1]);
      if (!(bits > 0 && bits <= 32)) continue;
      const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
      const net = (toInt(a.address) & mask) >>> 0;
      out.push({ net, bits, label: `${[24, 16, 8, 0].map((s) => (net >>> s) & 255).join(".")}/${bits}` });
    }
  }
  return out;
}

/**
 * Whether another machine's address is on one of this machine's own networks.
 * "other" does not prove it can't be reached (a router may route between
 * networks), but when the LAN check also fails it is almost always the reason:
 * it is plugged into a different router, a guest network, or another building.
 */
export function networkOf(addrs: string[]): "same" | "other" | "unknown" {
  const ips = addrs.filter((a) => IPV4.test(a));
  if (!ips.length) return "unknown";
  const nets = localNetworks();
  if (!nets.length) return "unknown";
  return ips.some((ip) => nets.some((n) => ((toInt(ip) & (n.bits === 32 ? 0xffffffff : (~0 << (32 - n.bits)) >>> 0)) >>> 0) === n.net)) ? "same" : "other";
}
