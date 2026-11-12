import crypto from "crypto";
import fsp from "fs/promises";
import http from "http";
import os from "os";
import path from "path";
import { clusterStatus, readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { PEER_PORT } from "./netAddrs";
import { handlePhone } from "./phoneAccess";

/**
 * Direct machine-to-machine link over the local network, so the machine group
 * doesn't have to wait for OneDrive (1-2 minutes) when machines share a LAN.
 *
 *  - Each Mission Control runs a small listener on 0.0.0.0:3101 that serves
 *    ONLY peer endpoints (/peer/...). The app UI and its API stay on
 *    127.0.0.1:3000, unreachable from the network.
 *  - Every call carries a shared key, created once in the vault
 *    (Agentic OS/Cluster/peer-key.txt), so only your own machines - which all
 *    sync that vault - can use the listener.
 *  - Addresses come from each machine's cluster heartbeat (its LAN IPs), or
 *    from an address you set. Per machine you choose (Fleet → Network):
 *      lan     try the LAN first, fall back to OneDrive when unreachable
 *      offlan  OneDrive only (a machine away from the main LAN)
 *      auto    same as lan (the default)
 *    Stored in Agentic OS/Cluster/network.json so every machine agrees.
 *  - Everything that can go over the LAN also still works through the vault.
 */

export type NetMode = "lan" | "offlan" | "auto";

export interface NetworkFile {
  v: 1;
  hosts: Record<string, { mode: NetMode; address?: string }>;
}

const clusterDir = () => path.join(vaultInfo().base, "Cluster");
const netFile = () => path.join(clusterDir(), "network.json");
const keyFile = () => path.join(clusterDir(), "peer-key.txt");

export async function readNetwork(): Promise<NetworkFile> {
  try {
    const f = JSON.parse(await fsp.readFile(netFile(), "utf8")) as NetworkFile;
    if (f && f.hosts) return f;
  } catch {
    /* none yet */
  }
  return { v: 1, hosts: {} };
}

export async function setHostNetwork(host: string, patch: { mode?: NetMode; address?: string }): Promise<NetworkFile> {
  const f = await readNetwork();
  const cur = f.hosts[host] ?? { mode: "auto" as NetMode };
  const next = { ...cur };
  if (patch.mode === "lan" || patch.mode === "offlan" || patch.mode === "auto") next.mode = patch.mode;
  if (patch.address !== undefined) {
    const a = patch.address.trim();
    if (a && !/^[A-Za-z0-9.:_-]{1,100}$/.test(a)) throw new Error("That doesn't look like an IP address or host name.");
    if (a) next.address = a;
    else delete next.address;
  }
  f.hosts[host] = next;
  await fsp.mkdir(clusterDir(), { recursive: true });
  const tmp = `${netFile()}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(f, null, 2), "utf8");
  await fsp.rename(tmp, netFile());
  good.delete(host);
  bad.delete(host);
  return f;
}

export function modeOf(net: NetworkFile, host: string): NetMode {
  const k = Object.keys(net.hosts).find((h) => h.toLowerCase() === host.toLowerCase());
  return (k && net.hosts[k].mode) || "auto";
}

// ─── shared key ───

let keyCache: { key: string; at: number } | null = null;
async function peerKey(): Promise<string | null> {
  if (keyCache && Date.now() - keyCache.at < 60_000) return keyCache.key;
  if (!(await vaultAvailable())) return null;
  let key = (await fsp.readFile(keyFile(), "utf8").catch(() => "")).trim();
  if (!key) {
    key = crypto.randomBytes(24).toString("hex");
    await fsp.mkdir(clusterDir(), { recursive: true });
    // wx: if another machine created it at the same moment, keep theirs
    await fsp.writeFile(keyFile(), key, { encoding: "utf8", flag: "wx" }).catch(() => {});
    key = (await fsp.readFile(keyFile(), "utf8").catch(() => key)).trim();
  }
  keyCache = { key, at: Date.now() };
  return key;
}

const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ─── client ───

const good = new Map<string, string>(); // host → address that worked
const bad = new Map<string, number>(); // host → don't retry before
const BACKOFF_MS = 60_000;

/** Addresses to try for a host, best first; [] when it's Off-LAN or unknown. */
export async function addressesFor(host: string): Promise<string[]> {
  const net = await readNetwork();
  if (modeOf(net, host) === "offlan") return [];
  const k = Object.keys(net.hosts).find((h) => h.toLowerCase() === host.toLowerCase());
  const manual = k ? net.hosts[k].address : undefined;
  const st = await clusterStatus().catch(() => null);
  const node = st?.nodes.find((n) => n.host.toLowerCase() === host.toLowerCase()) as { lanAddrs?: string[]; peerPort?: number } | undefined;
  const port = node?.peerPort ?? PEER_PORT;
  const list = [manual, good.get(host), ...(node?.lanAddrs ?? [])].filter((a): a is string => Boolean(a));
  return [...new Set(list)].map((a) => (/:\d+$/.test(a) && !a.includes("::") ? a : `${a}:${port}`));
}

export class PeerUnavailable extends Error {}

/**
 * Call another machine's peer endpoint over the LAN. Throws PeerUnavailable
 * when it's Off-LAN, has no known address, or can't be reached (then it isn't
 * retried for a minute, so callers fall back to the vault without waiting).
 */
export async function peerFetch<T>(host: string, p: string, init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  if (host === os.hostname()) throw new PeerUnavailable("that's this machine");
  if ((bad.get(host) ?? 0) > Date.now()) throw new PeerUnavailable("unreachable a moment ago");
  const key = await peerKey();
  if (!key) throw new PeerUnavailable("vault unavailable (no shared key)");
  const addrs = await addressesFor(host);
  if (!addrs.length) throw new PeerUnavailable("Off-LAN or no LAN address known");
  let lastErr = "";
  for (const a of addrs) {
    try {
      const res = await fetch(`http://${a}${p}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: { "x-mc-peer-key": key, "x-mc-peer-from": os.hostname(), ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? 2_500),
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      good.set(host, a.replace(/:\d+$/, ""));
      bad.delete(host);
      if (!res.ok) throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { peerAnswered: true });
      return data;
    } catch (e) {
      if ((e as { peerAnswered?: boolean }).peerAnswered) throw e; // it answered: a real error, not a network one
      lastErr = (e as Error).message;
    }
  }
  bad.set(host, Date.now() + BACKOFF_MS);
  good.delete(host);
  throw new PeerUnavailable(lastErr || "unreachable");
}

/** Is this host reachable over the LAN right now? (Fleet → Network) */
export async function probePeer(host: string): Promise<{ ok: boolean; ms?: number; address?: string; error?: string }> {
  bad.delete(host);
  const t = Date.now();
  try {
    await peerFetch<{ host: string }>(host, "/peer/ping", { timeoutMs: 2_000 });
    return { ok: true, ms: Date.now() - t, address: good.get(host) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Fire-and-forget to every LAN peer (e.g. a new session event). */
export async function broadcastPeers(p: string, body: unknown): Promise<void> {
  const st = await clusterStatus().catch(() => null);
  const others = (st?.nodes ?? []).filter((n) => !n.self && n.online);
  await Promise.allSettled(others.map((n) => peerFetch(n.host, p, { body, timeoutMs: 2_000 })));
}

// ─── server ───

type Handler = (q: URLSearchParams, body: unknown, from: string) => Promise<unknown>;

async function routes(): Promise<Record<string, Handler>> {
  const actions = await import("./sessionActions");
  const share = await import("./sessionShare");
  const events = await import("./sessionEvents");
  const search = await import("./sessionSearch");
  const handoff = await import("./handoff");
  const perms = await import("./permissions");
  const cfg = await readConfig();
  const gate = async () => {
    const s = await share.readShareSettings();
    if (s.remoteReplies === "off") throw Object.assign(new Error(`Replies from other machines are turned off on ${cfg.label || os.hostname()}.`), { status: 403 });
    return s;
  };
  return {
    "GET /peer/ping": async () => ({ host: os.hostname(), label: cfg.label || os.hostname(), at: Date.now() }),
    "GET /peer/summary": async () => share.localSummary(),
    "POST /peer/request": async (_q, body) => {
      const b = body as { job: never; content?: never };
      return { job: await actions.acceptRequest(b.job, "lan", b.content) };
    },
    "GET /peer/job": async (q) => actions.jobForPeer(q.get("id") ?? ""),
    "POST /peer/event": async (_q, body) => ({ ok: await events.ingestRemote((body as { events?: never[] }).events ?? []) }),
    "GET /peer/search": async (q) => {
      await gate();
      return { results: await search.searchLocal(q.get("q") ?? "", 30) };
    },
    "GET /peer/thread": async (q) => {
      await gate();
      const t = await actions.localThread(q.get("key") ?? "");
      if (!t) throw Object.assign(new Error("That session isn't on this machine."), { status: 404 });
      return t;
    },
    "GET /peer/export": async (q) => {
      await gate();
      return handoff.exportSession(q.get("key") ?? "");
    },
    // permission prompts waiting on this machine, and answering one (lib/permissions.ts)
    "GET /peer/permissions": async () => {
      await gate();
      return { items: await perms.pendingLocal() };
    },
    "POST /peer/permission": async (_q, body) => {
      await gate();
      const b = body as { id?: string; behavior?: string; always?: boolean; message?: string; by?: string };
      if (!b.id || (b.behavior !== "allow" && b.behavior !== "deny")) throw Object.assign(new Error("id and behavior (allow/deny) required"), { status: 400 });
      return { request: await perms.decideLocal(b.id, b.behavior, { always: b.always, message: b.message, by: b.by }) };
    },
  };
}

let server: http.Server | null = null;
let routeTable: Promise<Record<string, Handler>> | null = null;

/** Only meaningful in the module instance that started the server - use peerListening() elsewhere. */
export function peerServerRunning(): boolean {
  return Boolean(server?.listening);
}

/** Is the LAN listener up on this machine? (Asks the port itself, so it works from any part of the app.) */
export async function peerListening(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${PEER_PORT}/peer/ping`, { signal: AbortSignal.timeout(1_500) });
    return true; // any answer (a 401 without the key) means it's listening
  } catch {
    return false;
  }
}

export function startPeerServer(): void {
  if (server || process.env.MC_NO_PEER === "1") return;
  server = http.createServer(async (req, res) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    // everything else on this port is Phone access (off unless turned on, PIN-protected)
    if (!(req.url ?? "/").startsWith("/peer/")) {
      return void handlePhone(req, res).catch((e) => {
        if (!res.headersSent) send(500, { error: (e as Error).message });
        else res.end();
      });
    }
    try {
      const key = await peerKey();
      const given = String(req.headers["x-mc-peer-key"] ?? "");
      if (!key || !given || !safeEq(given, key)) return send(401, { error: "not a Mission Control peer" });
      const url = new URL(req.url ?? "/", "http://peer");
      routeTable ??= routes();
      const h = (await routeTable)[`${req.method} ${url.pathname}`];
      if (!h) return send(404, { error: "unknown peer endpoint" });
      let body: unknown = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 60 * 1024 * 1024) return send(413, { error: "too large" });
          chunks.push(c as Buffer);
        }
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      }
      send(200, await h(url.searchParams, body, String(req.headers["x-mc-peer-from"] ?? "")));
    } catch (e) {
      send((e as { status?: number }).status ?? 400, { error: (e as Error).message });
    }
  });
  server.on("error", (e) => {
    console.error(`[mission-control] LAN peer listener on :${PEER_PORT} failed: ${(e as Error).message}`);
    server = null;
  });
  server.listen(PEER_PORT, "0.0.0.0", () => console.log(`[mission-control] LAN peer listener on 0.0.0.0:${PEER_PORT}`));
}
