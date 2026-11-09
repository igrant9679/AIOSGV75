import crypto from "crypto";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { sessionsSnapshot } from "./sessions";
import { mergeRemoteSessions, readRemoteSessions } from "./sessionShare";
import { liveSnapshot, type LiveSession } from "./sessionLive";
import { eventsView, type EventsView, type SessionEvent } from "./sessionEvents";

/**
 * The whole machine group's live state in one place: what every open session
 * on every machine is doing (live view) and what needs you (events). LAN
 * machines answer directly (fresh to the second); Off-LAN machines are read
 * from the vault (Agentic OS/Cluster/live/<host>.json, events/<host>.json).
 */

const liveDir = () => path.join(vaultInfo().base, "Cluster", "live");
// written on every change and at least every 10 minutes (publishLive)
const FRESH_MS = 12 * 60_000;

export interface FleetLive {
  live: LiveSession[];
  machines: { host: string; label: string; via: "lan" | "vault" | "self"; at: number }[];
}

async function vaultLive(host: string): Promise<{ at: number; live: LiveSession[] } | null> {
  try {
    const f = JSON.parse(await fsp.readFile(path.join(liveDir(), `${host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`), "utf8")) as { at: number; live: LiveSession[] };
    return Date.now() - f.at < FRESH_MS ? f : null;
  } catch {
    return null;
  }
}

export async function fleetLive(): Promise<FleetLive> {
  const [mine, files, cfg] = await Promise.all([liveSnapshot().catch(() => []), readRemoteSessions().catch(() => []), readConfig().catch(() => null)]);
  const live: LiveSession[] = [...mine];
  const machines: FleetLive["machines"] = [{ host: os.hostname(), label: cfg?.label || os.hostname(), via: "self", at: Date.now() }];
  for (const f of files) {
    if (f.via === "lan" && f.live) {
      live.push(...f.live.map((l) => ({ ...l, host: f.host, hostLabel: f.label || f.host })));
      machines.push({ host: f.host, label: f.label || f.host, via: "lan", at: f.publishedAt });
    } else {
      const v = await vaultLive(f.host);
      if (v) {
        live.push(...v.live.map((l) => ({ ...l, host: f.host, hostLabel: f.label || f.host })));
        machines.push({ host: f.host, label: f.label || f.host, via: "vault", at: v.at });
      }
    }
  }
  const rank = (l: LiveSession) => (l.status === "waiting" ? 0 : l.stuck || l.looping ? 1 : l.status === "running" ? 2 : 3);
  live.sort((a, b) => rank(a) - rank(b) || b.lastActivity - a.lastActivity);
  return { live, machines };
}

export async function fleetEvents(): Promise<EventsView> {
  const snap = await sessionsSnapshot();
  const [{ sessions }, files] = await Promise.all([mergeRemoteSessions(snap.sessions), readRemoteSessions().catch(() => [])]);
  const extra: SessionEvent[] = files.flatMap((f) => (f.via === "lan" ? (f.events ?? []) : []));
  return eventsView(sessions, extra);
}

let lastHash = "";
let lastWrite = 0;
/** Every machine, every minute: this machine's live state → the vault, for Off-LAN machines. */
export async function publishLive(): Promise<void> {
  const cfg = await readConfig().catch(() => null);
  if (!cfg?.enabled || !(await vaultAvailable())) return;
  const live = await liveSnapshot();
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify(live.map((l) => [l.key, l.status, l.step, l.stuck, l.looping])))
    .digest("hex");
  // nothing open and nothing changed: stay quiet (an empty file was already written)
  if (hash === lastHash && Date.now() - lastWrite < 10 * 60_000) return;
  lastHash = hash;
  lastWrite = Date.now();
  await fsp.mkdir(liveDir(), { recursive: true });
  const file = path.join(liveDir(), `${os.hostname().replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ host: os.hostname(), at: Date.now(), live }), "utf8");
  await fsp.rename(tmp, file);
}
