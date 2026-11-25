import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readConfig } from "./cluster";
import { vaultAvailable } from "./vault";
import { requestsDir, writeVaultJson } from "./sessionActions";

/**
 * "Is it really talking to me through OneDrive?" — a round trip you can ask for.
 *
 * The heartbeat only proves one direction (that machine writes, the file syncs
 * here). This leaves a tiny request in that machine's request folder in the
 * vault — the same folder replies and session moves use — and waits for its
 * answer to sync back. ANY answer proves both directions: a machine on older
 * code answers "unknown request", one with replies from other machines turned
 * off answers that it is off, and both are still round trips. Nothing is run
 * there either way; a ping is answered before any request handling.
 *
 * State: data/onedrive-pings.json on this machine, re-read on every call.
 */

export interface PingState {
  id: string;
  sentAt: number;
  /** when the answer was found here */
  answeredAt?: number;
  /** what came back, in its words (e.g. "pong from IdrisArea51" or "unknown request") */
  answer?: string;
}

const FILE = path.join(process.cwd(), "data", "onedrive-pings.json");
/** Past this, a ping is reported as unanswered (OneDrive both ways is normally 1-4 minutes). */
export const PING_GIVE_UP_MS = 15 * 60_000;
const HOST_RE = /^[\w.-]{1,80}$/;

async function readPings(): Promise<Record<string, PingState>> {
  try {
    const j = JSON.parse(await fsp.readFile(FILE, "utf8"));
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

async function writePings(p: Record<string, PingState>): Promise<void> {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(p, null, 1), "utf8");
  await fsp.rename(tmp, FILE);
}

/** Leave a ping for `host` in the vault. */
export async function sendPing(host: string): Promise<PingState> {
  if (!HOST_RE.test(host) || host.toLowerCase() === os.hostname().toLowerCase()) throw new Error("bad host");
  if (!(await vaultAvailable())) throw new Error("The vault (OneDrive folder) isn't available on this machine.");
  const cfg = await readConfig().catch(() => null);
  const id = `sj-ping-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sentAt = Date.now();
  await writeVaultJson(path.join(requestsDir(host), `${id}.json`), {
    sentAt,
    job: { id, mode: "ping", requestedBy: os.hostname(), requestedByLabel: cfg?.label || os.hostname(), tool: "claude", createdAt: sentAt },
  });
  const all = await readPings();
  // a newer ping replaces an older one; tidy the old request if it was never picked up
  const old = all[host];
  if (old && !old.answeredAt) await fsp.rm(path.join(requestsDir(host), `${old.id}.json`), { force: true }).catch(() => {});
  all[host] = { id, sentAt };
  await writePings(all);
  return all[host];
}

/** Every machine's latest ping, picking up answers that have synced back since the last look. */
export async function pingStates(): Promise<Record<string, PingState>> {
  const all = await readPings();
  let changed = false;
  for (const [host, p] of Object.entries(all)) {
    if (p.answeredAt) continue;
    const file = path.join(requestsDir(host), "results", `${p.id}.json`);
    try {
      const r = JSON.parse(await fsp.readFile(file, "utf8")) as { status?: string; reply?: string; error?: string };
      p.answeredAt = Date.now();
      p.answer = String(r.reply || r.error || r.status || "answered").slice(0, 200);
      changed = true;
      await fsp.rm(file, { force: true }).catch(() => {});
    } catch {
      /* not back yet */
    }
  }
  if (changed) await writePings(all);
  return all;
}
