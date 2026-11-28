import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultInfo } from "./vault";

/**
 * The Work home (rule 48): the ONE machine that keeps Work (/work) and does its background duties: the
 * GitHub-report → Work sync, assigning, following started tasks, LevelUp hand-offs. Before this, every
 * machine whose GitHub CLI was signed in kept its own copy of the same tasks (three on 2026-11-28), each
 * assigning on its own. The owner chose Legion7 (always on; Raider18 often off).
 *
 * The choice is a vault file (Agentic OS/Cluster/work-home.json) so every machine agrees. On the other
 * machines /api/work is answered by the home over the LAN (peer GET/POST /peer/work), so Work looks and
 * works the same from any machine; their own old files are left alone and unused. Unset = the old
 * behaviour (each machine its own), so nothing changes until a home is chosen.
 */

export interface WorkHome { host: string; label: string; at: number; by: string }
const file = () => path.join(vaultInfo().base, "Cluster", "work-home.json");
const DATA = path.join(process.cwd(), "data");

export function readWorkHome(): WorkHome | null {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    return j && typeof j.host === "string" && j.host ? { host: j.host, label: String(j.label || j.host), at: Number(j.at) || 0, by: String(j.by || "") } : null;
  } catch {
    return null;
  }
}

/** True when this machine is the Work home, or when no home has been chosen (each machine its own). */
export function isWorkHome(): boolean {
  const h = readWorkHome();
  return !h || h.host === os.hostname();
}

export async function writeWorkHome(h: WorkHome): Promise<void> {
  const f = file();
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(h, null, 2), "utf8");
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, f);
      return;
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

/** The files that ARE Work on a machine (what moves when the home moves). */
export const WORK_FILES = ["repo-tasks.json", "repo-tasks-settings.json", "areas.json", "github-report.json"];

/** This machine's Work files, for the move (the LevelUp key stays put: connect again on the new home). */
export async function packWork(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of WORK_FILES) {
    try {
      out[f] = await fsp.readFile(path.join(DATA, f), "utf8");
    } catch {
      /* not there */
    }
  }
  return out;
}

/**
 * On the new home: take the moved files. Anything already here is kept in data/work-backup-<time>/ first.
 * Only the known file names, each must be JSON; the GitHub report is taken only if it's newer than ours.
 */
export async function unpackWork(files: Record<string, unknown>): Promise<{ written: string[]; backup?: string }> {
  const written: string[] = [];
  const backupDir = path.join(DATA, `work-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  let backedUp = false;
  for (const f of WORK_FILES) {
    const text = files?.[f];
    if (typeof text !== "string" || text.length > 50_000_000) continue;
    try {
      JSON.parse(text);
    } catch {
      continue;
    }
    const target = path.join(DATA, f);
    if (fs.existsSync(target)) {
      if (f === "github-report.json") {
        try {
          const ours = JSON.parse(fs.readFileSync(target, "utf8"));
          const theirs = JSON.parse(text);
          if ((Date.parse(ours.generatedAt) || 0) >= (Date.parse(theirs.generatedAt) || 0)) continue;
        } catch {
          /* replace a broken one */
        }
      }
      await fsp.mkdir(backupDir, { recursive: true });
      await fsp.copyFile(target, path.join(backupDir, f));
      backedUp = true;
    }
    await fsp.mkdir(DATA, { recursive: true });
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, text, "utf8");
    await fsp.rename(tmp, target);
    written.push(f);
  }
  return { written, backup: backedUp ? backupDir : undefined };
}

/**
 * The home needs a fresh GitHub report to keep Work in step. If it has no GitHub sign-in of its own (or its
 * report is older), it takes the newest report another machine made (peer GET /peer/github-report, over the
 * LAN only: private repository details never go to the vault) and syncs Work from it. Every 30 minutes.
 */
let lastBorrow = 0;
export async function borrowGithubReport(): Promise<void> {
  if (Date.now() - lastBorrow < 25 * 60_000) return;
  lastBorrow = Date.now();
  const home = readWorkHome();
  if (!home || home.host !== os.hostname()) return;
  const { readGithubReport } = await import("./githubReport");
  const ours = await readGithubReport().catch(() => null);
  const oursAt = Date.parse((ours as { generatedAt?: string } | null)?.generatedAt ?? "") || 0;
  if (Date.now() - oursAt < 20 * 3600e3) return; // ours is recent enough (made here, or borrowed earlier today)
  const { clusterStatus } = await import("./cluster");
  const { peerFetch } = await import("./peer");
  const st = await clusterStatus().catch(() => null);
  let best: { report: { generatedAt?: string; anonymous?: boolean } & Record<string, unknown>; at: number; from: string } | null = null;
  for (const n of st?.nodes ?? []) {
    if (n.host === os.hostname() || !n.online) continue;
    try {
      const r = await peerFetch<{ report: ({ generatedAt?: string; anonymous?: boolean } & Record<string, unknown>) | null }>(n.host, "/peer/github-report", { timeoutMs: 20_000 });
      const at = Date.parse(r.report?.generatedAt ?? "") || 0;
      if (r.report && !r.report.anonymous && at > (best?.at ?? oursAt)) best = { report: r.report, at, from: n.label ?? n.host };
    } catch {
      /* off or older version */
    }
  }
  if (!best) return;
  await unpackWork({ "github-report.json": JSON.stringify(best.report) });
  const { afterGithubReport } = await import("./repoTasks");
  await afterGithubReport(best.report as never);
  console.log(`[mission-control] work home: took ${best.from}'s GitHub report (${new Date(best.at).toISOString()}) and synced Work`);
}
