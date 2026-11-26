import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * How loaded this machine is: CPU, memory, the Windows commit charge, GPU, and the processes
 * holding the most memory. Sampled every minute by the scheduler (data/load.json), carried in
 * the cluster heartbeat so every machine sees every other's, and used three ways:
 *
 *  - Fleet's grid shows it per machine;
 *  - run placement and Run somewhere skip a machine whose memory is nearly full, and prefer the
 *    emptier ones (lib/runPlacement.ts, lib/dispatch.ts);
 *  - Health warns BEFORE a crash, naming what holds the memory.
 *
 * Why commit and not just RAM: on 2026-11-25 Raider18 crashed (Mission Control and Ollama,
 * 0xC0000409) with RAM to spare. Windows refuses memory once the COMMIT charge reaches its
 * limit (RAM + page file), and each WanGP MCP server (wgp.py) reserved ~3.9 GB of it.
 * The commit percentage is the number that predicts that crash.
 */

export interface LoadProcess {
  /** program name, or for python/node the script it runs ("wgp.py") */
  name: string;
  count: number;
  /** private memory (commit) in GB */
  gb: number;
}

export interface MachineLoad {
  at: number;
  /** % of CPU busy since the previous sample */
  cpu?: number;
  /** physical memory in use, % */
  memUsed: number;
  memTotalGb: number;
  /** Windows commit charge, % of the commit limit (RAM + page file) */
  commitUsed?: number;
  commitLimitGb?: number;
  gpus?: { util: number; memUsedMb: number; memTotalMb: number }[];
  top: LoadProcess[];
}

/**
 * At or above MEM_WARN, Health warns and placement prefers other machines; at or above MEM_FULL
 * placement sends nothing new there and Health fails the check. Defined with the (pure)
 * placement rules so their test covers them.
 */
export { MEM_WARN, MEM_FULL } from "./runPlacement";

const FILE = path.join(process.cwd(), "data", "load.json");

/** The number that predicts running out: commit on Windows, physical memory elsewhere. */
export function memPressure(l: Pick<MachineLoad, "memUsed" | "commitUsed"> | null | undefined): number | undefined {
  if (!l) return undefined;
  return typeof l.commitUsed === "number" ? l.commitUsed : l.memUsed;
}

export function readLoad(maxAgeMs = 5 * 60_000): MachineLoad | null {
  try {
    const l = JSON.parse(fs.readFileSync(FILE, "utf8")) as MachineLoad;
    return Date.now() - l.at <= maxAgeMs ? l : null;
  } catch {
    return null;
  }
}

/** Short line for the Fleet grid and the Health detail. */
export function loadLine(l: MachineLoad): string {
  const parts: string[] = [];
  if (typeof l.cpu === "number") parts.push(`CPU ${l.cpu}%`);
  parts.push(`RAM ${l.memUsed}% of ${l.memTotalGb} GB`);
  if (typeof l.commitUsed === "number") parts.push(`commit ${l.commitUsed}% of ${l.commitLimitGb} GB`);
  for (const g of l.gpus ?? []) parts.push(`GPU ${g.util}% · ${Math.round(g.memUsedMb / 1024)} of ${Math.round(g.memTotalMb / 1024)} GB`);
  return parts.join(" · ");
}

export const topLine = (l: MachineLoad, n = 3) =>
  l.top
    .slice(0, n)
    .map((p) => `${p.name}${p.count > 1 ? ` ×${p.count}` : ""} ${p.gb.toFixed(1)} GB`)
    .join(", ");

/**
 * Every machine's memory pressure, from this machine's own sample and the others' heartbeats.
 * A load older than 5 minutes counts as unknown: never avoid a machine on stale numbers.
 */
export async function memoryByHost(): Promise<(host: string) => number | undefined> {
  const { clusterStatus } = await import("./cluster"); // cluster.ts imports this file for the heartbeat
  const nodes = (await clusterStatus().catch(() => null))?.nodes ?? [];
  const me = os.hostname().toLowerCase();
  const fresh = (l?: MachineLoad) => (l && Date.now() - l.at < 5 * 60_000 ? l : undefined);
  return (host: string) => {
    const h = host.toLowerCase();
    if (h === me) return memPressure(readLoad());
    return memPressure(fresh(nodes.find((n) => n.host.toLowerCase() === h)?.load));
  };
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(cmd, args, { windowsHide: true });
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(t);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(t);
      resolve(out);
    });
  });
}

// CPU: busy share between two samples (os.loadavg() is always 0 on Windows)
let lastCpu: { idle: number; total: number } | null = null;
function cpuPercent(): number | undefined {
  const t = os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.idle + c.times.user + c.times.sys + c.times.irq + c.times.nice }), { idle: 0, total: 0 });
  const prev = lastCpu;
  lastCpu = t;
  if (!prev || t.total <= prev.total) return undefined;
  return Math.round(100 * (1 - (t.idle - prev.idle) / (t.total - prev.total)));
}

// A process's display name: python/node show the script they run, so the eight "python.exe"
// lines say what they are. Only the script's FILE NAME leaves this function, never the command line.
const RUNNERS = /^(python|pythonw|python3|node|bun|deno|java|ruby|perl)(\.exe)?$/i;
function labelOf(name: string, cmd: string): string {
  const base = name.replace(/\.exe$/i, "");
  if (!RUNNERS.test(name) || !cmd) return base;
  const m = cmd.match(/[\\/]?([\w.-]+\.(?:py|pyw|js|mjs|cjs|ts|jar|rb|pl))\b/i);
  return m ? m[1] : base;
}

function group(rows: { name: string; cmd: string; bytes: number }[]): LoadProcess[] {
  const by = new Map<string, LoadProcess>();
  for (const r of rows) {
    if (!r.bytes) continue;
    const name = labelOf(r.name, r.cmd);
    const g = by.get(name) ?? { name, count: 0, gb: 0 };
    g.count++;
    g.gb += r.bytes / 1024 ** 3;
    by.set(name, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, gb: Math.round(g.gb * 10) / 10 }))
    .sort((a, b) => b.gb - a.gb)
    .slice(0, 6);
}

async function gpus(): Promise<MachineLoad["gpus"]> {
  const out = await run("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], 8_000);
  const list = out
    .split(/\r?\n/)
    .map((l) => l.split(",").map((x) => Number(x.trim())))
    .filter((v) => v.length === 3 && v.every((n) => Number.isFinite(n)))
    .map(([util, memUsedMb, memTotalMb]) => ({ util, memUsedMb, memTotalMb }));
  return list.length ? list : undefined;
}

/** Take a sample now and save it (the scheduler calls this every minute). */
export async function sampleLoad(): Promise<MachineLoad> {
  const total = os.totalmem();
  const load: MachineLoad = {
    at: Date.now(),
    cpu: cpuPercent(),
    memUsed: Math.round((100 * (total - os.freemem())) / total),
    memTotalGb: Math.round(total / 1024 ** 3),
    top: [],
  };
  if (process.platform === "win32") {
    // One PowerShell for the commit charge and the biggest processes (private bytes = commit).
    const ps =
      // Win32_OperatingSystem.FreeVirtualMemorySize came back EMPTY on Raider18 (read as 0 = "100%
      // full" while the real figure was 80%); the perf class is the counter itself, not localized.
      "$m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; " +
      "$p = Get-CimInstance Win32_Process | Sort-Object PrivatePageCount -Descending | Select-Object -First 60 | ForEach-Object { @{ n = [string]$_.Name; c = [string]$_.CommandLine; b = [double]$_.PrivatePageCount } }; " +
      "@{ limit = [double]$m.CommitLimit; used = [double]$m.CommittedBytes; procs = @($p) } | ConvertTo-Json -Depth 4 -Compress";
    const [out, g] = await Promise.all([run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], 30_000), gpus()]);
    try {
      const j = JSON.parse(out) as { limit: number; used: number; procs: { n: string; c: string; b: number }[] };
      // both must be real: a missing value is "unknown", never "full"
      if (j.limit > 0 && j.used > 0 && j.used <= j.limit * 1.05) {
        load.commitUsed = Math.round((100 * j.used) / j.limit);
        load.commitLimitGb = Math.round(j.limit / 1024 ** 3);
      }
      load.top = group((j.procs ?? []).map((p) => ({ name: p.n, cmd: p.c ?? "", bytes: p.b })));
    } catch {
      /* keep the basics */
    }
    load.gpus = g;
  } else {
    const [out, g] = await Promise.all([run("ps", ["-axo", "rss=,comm=,args="], 10_000), gpus()]);
    load.top = group(
      out
        .split("\n")
        .map((l) => l.trim().match(/^(\d+)\s+(\S+)\s*(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ name: path.basename(m[2]), cmd: m[3], bytes: Number(m[1]) * 1024 })),
    );
    load.gpus = g;
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(load), "utf8");
  } catch {
    /* shown next time */
  }
  return load;
}
