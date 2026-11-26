import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";

/**
 * One switch that holds the autonomous work of EVERY machine: before a reboot, an update, or
 * when something looks wrong. It is a file in the vault (Agentic OS/Cluster/pause.json), so
 * every machine sees it within OneDrive's sync time, and any machine can turn it off.
 *
 * While paused:
 *   - the master starts no schedules, watchers, approved missions, pipeline builds, YouTube
 *     rescans, bridge work or profile refresh (lib/scheduler.ts);
 *   - project runs don't advance (lib/runs.ts runsTick); their state waits in the vault;
 *   - queued session runs, including ones other machines ask for, wait (pump in
 *     lib/sessionActions.ts) and start after the resume.
 * What is already running finishes. What you start yourself (a chat, a mission, a reply)
 * still runs: the pause is for work nobody is watching. Updates (Fleet → Versions) still run,
 * because "pause, update, resume" is the point.
 *
 * A pause can end by itself (`until`), so a forgotten one cannot stop the schedules for good;
 * Health shows it on every machine while it lasts.
 */

export interface FleetPause {
  paused: boolean;
  /** machine label and host that set it */
  by?: string;
  host?: string;
  at?: number;
  /** ends by itself then; undefined = until someone resumes */
  until?: number;
  reason?: string;
}

const file = () => path.join(vaultInfo().base, "Cluster", "pause.json");

/** The pause as it stands now (an expired one reads as not paused). Read fresh each time: rule 1. */
export function readPause(): FleetPause {
  try {
    const p = JSON.parse(fs.readFileSync(file(), "utf8")) as FleetPause;
    if (!p.paused) return { paused: false };
    if (p.until && p.until <= Date.now()) return { paused: false };
    return p;
  } catch {
    return { paused: false };
  }
}

export const isPaused = () => readPause().paused;

/** Turn the fleet pause on (for `hours`, or until resumed) or off. */
export async function setPause(paused: boolean, opts: { by: string; hours?: number; reason?: string }): Promise<FleetPause> {
  if (!(await vaultAvailable())) throw new Error("The vault isn't available on this machine, so the pause can't reach the others.");
  const hours = typeof opts.hours === "number" && opts.hours > 0 && opts.hours <= 72 ? opts.hours : undefined;
  const next: FleetPause = paused
    ? { paused: true, by: opts.by.slice(0, 60), host: os.hostname(), at: Date.now(), until: hours ? Date.now() + hours * 3_600_000 : undefined, reason: opts.reason?.trim().slice(0, 200) || undefined }
    : { paused: false, by: opts.by.slice(0, 60), host: os.hostname(), at: Date.now() };
  const f = file();
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  // OneDrive can refuse a rename onto a file it is uploading for a moment (rule 24)
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, f);
      break;
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  return next;
}
