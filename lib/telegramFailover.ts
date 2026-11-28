import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Telegram failover (rule 47, step 5). Only ONE machine may poll the Telegram bot (two take each other's
 * messages), and that machine (the primary, Legion7) can go down. A STANDBY machine with this switched on
 * (Talos settings → failover) watches the primary's heartbeat: after `minutes` without one it starts its own
 * OpenClaw gateway (`openclaw gateway start`) and says so on Telegram; as soon as the primary's heartbeat
 * is back it stops the gateway again and hands back. It never starts a gateway while the primary is alive.
 *
 * The standby must be prepared ONCE by the owner: OpenClaw with the same Telegram channel added, and its
 * gateway STOPPED with its auto-start task off (otherwise it would poll all the time). The decision is
 * pure (`failoverDecision`, scripts/test-talos.mjs); state in data/telegram-failover.json.
 */

type Any = any;
const STATE = path.join(process.cwd(), "data", "telegram-failover.json");

export interface FailoverState { active: boolean; since?: number; lastAction?: string; lastAt?: number; error?: string }

/** What to do now. primaryAgeMin = minutes since the primary's last heartbeat (null = unknown). */
export function failoverDecision(o: { enabled: boolean; active: boolean; primaryAgeMin: number | null; minutes: number; isPrimary: boolean }): "start" | "stop" | "none" {
  if (o.isPrimary) return o.active ? "stop" : "none";
  if (!o.enabled) return o.active ? "stop" : "none";
  if (o.primaryAgeMin === null) return "none";
  if (!o.active && o.primaryAgeMin >= o.minutes) return "start";
  if (o.active && o.primaryAgeMin < 2) return "stop";
  return "none";
}

export function readFailoverState(): FailoverState {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return { active: false };
  }
}
function writeState(s: FailoverState) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), "utf8");
}

function openclaw(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const cmd = process.env.OPENCLAW_CMD || "openclaw";
    const p = spawn(cmd, args, { shell: process.platform === "win32", windowsHide: true });
    let out = "";
    p.stdout?.on("data", (d) => (out += d));
    p.stderr?.on("data", (d) => (out += d));
    const t = setTimeout(() => p.kill(), 60_000);
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, out: out.slice(-600) });
    });
    p.on("error", (e) => resolve({ ok: false, out: e.message }));
  });
}

let lastRun = 0;
export async function failoverTick(): Promise<void> {
  if (Date.now() - lastRun < 55_000) return;
  lastRun = Date.now();
  const { readTalosSettings } = await import("./talosNotify");
  const s = (await readTalosSettings()).failover;
  const state = readFailoverState();
  if (!s.enabled && !state.active) return;
  const { clusterStatus } = await import("./cluster");
  const st: Any = await clusterStatus().catch(() => null);
  const primary = st?.nodes?.find((n: Any) => n.host === s.primaryHost || n.label === s.primaryHost);
  const isPrimary = !!primary && primary.host === os.hostname();
  const primaryAgeMin = primary?.ts ? (Date.now() - primary.ts) / 60000 : null;
  const d = failoverDecision({ enabled: s.enabled && !!primary, active: state.active, primaryAgeMin, minutes: s.minutes, isPrimary });
  if (d === "none") return;
  const { sendTelegram } = await import("./telegram");
  const { readConfig } = await import("./cluster");
  const label = (await readConfig().catch(() => null))?.label || os.hostname();
  if (d === "start") {
    const r = await openclaw(["gateway", "start"]);
    writeState({ active: r.ok, since: Date.now(), lastAction: "start", lastAt: Date.now(), error: r.ok ? undefined : r.out });
    if (r.ok) await sendTelegram(`🛟 ${primary?.label ?? s.primaryHost} has been quiet for ${Math.round(primaryAgeMin ?? 0)} minutes, so ${label} took over Telegram. I'll hand back when it returns.`).catch(() => false);
  } else {
    const r = await openclaw(["gateway", "stop"]);
    writeState({ active: !r.ok, lastAction: "stop", lastAt: Date.now(), error: r.ok ? undefined : r.out });
    if (r.ok) await sendTelegram(`🛟 ${primary?.label ?? s.primaryHost} is back; ${label} handed Telegram back to it.`).catch(() => false);
  }
}
