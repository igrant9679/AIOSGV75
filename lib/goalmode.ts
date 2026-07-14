import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { sendTelegram } from "./telegram";

/**
 * Hermes Goal Mode: hand Hermes a long-horizon goal and walk away. Each goal
 * runs `hermes chat --yolo --max-turns N` in its own scratch directory, output
 * tailing live into the UI. State in data/goalruns.json (source of truth);
 * the child process lives only in THIS server instance, so a running goal
 * whose process we don't hold is marked stale after a long idle.
 */
export interface GoalRun {
  id: string;
  goal: string;
  status: "running" | "done" | "error" | "stopped";
  maxTurns: number;
  scratchDir: string;
  createdAt: number;
  finishedAt?: number;
  exitCode?: number;
  log: string; // tail of combined stdout/stderr
}

const FILE = path.join(process.cwd(), "data", "goalruns.json");
const MAX_RUNS = 40;
const LOG_TAIL = 20_000;
const STALE_MS = 6 * 60 * 60_000;

const procs = new Map<string, ReturnType<typeof spawn>>();
const live = new Map<string, GoalRun>();

function hermesBin(): string {
  return process.env.HERMES_BIN ?? "hermes";
}

async function readDisk(): Promise<GoalRun[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as GoalRun[];
  } catch {
    return [];
  }
}

export async function listGoalRuns(): Promise<GoalRun[]> {
  const disk = await readDisk();
  const merged = disk.map((g) => {
    const mine = live.get(g.id);
    if (mine) return mine;
    if (g.status === "running" && Date.now() - (g.finishedAt ?? g.createdAt) > STALE_MS) {
      g.status = "error";
    }
    return g;
  });
  for (const g of live.values()) if (!merged.some((x) => x.id === g.id)) merged.unshift(g);
  return merged.sort((a, b) => b.createdAt - a.createdAt);
}

async function save(run: GoalRun): Promise<void> {
  const disk = await readDisk();
  const i = disk.findIndex((g) => g.id === run.id);
  if (i >= 0) disk[i] = run;
  else disk.unshift(run);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(disk.slice(0, MAX_RUNS), null, 2), "utf8");
}

export async function stopGoalRun(id: string): Promise<boolean> {
  const proc = procs.get(id);
  const run = live.get(id) ?? (await readDisk()).find((g) => g.id === id);
  if (!run) return false;
  if (proc) {
    proc.kill();
    procs.delete(id);
  }
  if (run.status === "running") {
    run.status = "stopped";
    run.finishedAt = Date.now();
    await save(run);
    live.delete(id);
  }
  return true;
}

let seq = 0;

export async function startGoalRun(goal: string, maxTurns: number): Promise<GoalRun> {
  const id = `goal-${Date.now().toString(36)}-${seq++}`;
  const scratchDir = path.join(os.homedir(), "hermes-goals", id);
  await fs.mkdir(scratchDir, { recursive: true });

  const run: GoalRun = {
    id,
    goal: goal.slice(0, 4000),
    status: "running",
    maxTurns,
    scratchDir,
    createdAt: Date.now(),
    log: "",
  };
  live.set(id, run);
  await save(run);

  // hermes chat --yolo --max-turns N, prompt via -z, in its own scratch dir
  const child = spawn(
    hermesBin(),
    ["chat", "--yolo", "--max-turns", String(maxTurns), "-z", goal],
    { cwd: scratchDir, shell: true, env: process.env }
  );
  procs.set(id, child);

  let lastSave = 0;
  const append = (chunk: string) => {
    run.log = (run.log + chunk).slice(-LOG_TAIL);
    const now = Date.now();
    if (now - lastSave > 3_000) {
      lastSave = now;
      void save(run);
    }
  };
  child.stdout?.on("data", (c: Buffer) => append(c.toString("utf8")));
  child.stderr?.on("data", (c: Buffer) => append(c.toString("utf8")));

  child.on("error", (e) => {
    run.status = "error";
    run.log = (run.log + `\n[spawn error] ${e.message}`).slice(-LOG_TAIL);
    run.finishedAt = Date.now();
    procs.delete(id);
    void save(run).then(() => live.delete(id));
  });

  child.on("close", (code) => {
    if (run.status === "stopped") return; // already handled by stopGoalRun
    run.status = code === 0 ? "done" : "error";
    run.exitCode = code ?? undefined;
    run.finishedAt = Date.now();
    procs.delete(id);
    void save(run).then(() => live.delete(id));
    void sendTelegram(
      `🎯 Goal Mode ${run.status}: "${goal.slice(0, 100)}"\nRan ${maxTurns} max turns in ${scratchDir}. Check the dashboard for output.`
    ).catch(() => {});
  });

  return run;
}

/** List files Hermes produced in a goal's scratch dir (top level, capped). */
export async function goalArtifacts(id: string): Promise<{ name: string; size: number }[]> {
  const run = (await listGoalRuns()).find((g) => g.id === id);
  if (!run) return [];
  try {
    const entries = await fs.readdir(run.scratchDir, { withFileTypes: true });
    const files: { name: string; size: number }[] = [];
    for (const e of entries.slice(0, 50)) {
      if (e.isFile()) {
        try {
          files.push({ name: e.name, size: (await fs.stat(path.join(run.scratchDir, e.name))).size });
        } catch {
          /* skip */
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}
