import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Why did the server stop? A small, synchronous log of the server's life, kept apart from its
 * console output (data\server.log, written by server.cmd --log) so it survives anything:
 *
 *   data\server-events.log   start, exit (code + uptime + memory), signals, uncaught errors,
 *                            a memory reading every 10 minutes
 *   data\reports\            Node's own diagnostic report on a fatal crash (e.g. out of memory)
 *
 * If the process vanishes with no "exit" line at all, something outside ended it (Task Manager,
 * a security tool, a dev cycle killing port 3000). The watchdog copies the last lines of both
 * logs into data\watchdog.log whenever it finds the server down.
 */
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "server-events.log");
const MAX = 1024 * 1024;
const started = Date.now();

function mem(): string {
  const m = process.memoryUsage();
  const mb = (n: number) => `${Math.round(n / 1048576)}MB`;
  return `rss ${mb(m.rss)}, heap ${mb(m.heapUsed)}/${mb(m.heapTotal)}`;
}
function uptime(): string {
  const s = Math.round((Date.now() - started) / 1000);
  return s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
}

export function serverEvent(msg: string): void {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    try {
      if (fs.statSync(FILE).size > MAX) fs.renameSync(FILE, FILE + ".1");
    } catch {
      /* no file yet */
    }
    const local = new Date().toLocaleString("sv-SE").replace("T", " ");
    fs.appendFileSync(FILE, `${local} [pid ${process.pid}] ${msg}\n`, "utf8");
  } catch {
    /* logging must never take the server down */
  }
}

const g = globalThis as { __mcServerLog?: boolean };

export function startServerLog(): void {
  if (g.__mcServerLog) return;
  g.__mcServerLog = true;
  serverEvent(`started - node ${process.version}, ${mem()}`);

  // fatal errors (out of memory, native crashes) end the process without an "exit" event;
  // Node writes a report file first
  try {
    const dir = path.join(DATA, "reports");
    fs.mkdirSync(dir, { recursive: true });
    process.report.directory = dir;
    process.report.reportOnFatalError = true;
  } catch {
    /* reports unavailable */
  }

  // Next.js logs these and keeps running; record them here too, with the stack
  process.on("uncaughtException", (e) => serverEvent(`uncaughtException: ${(e as Error)?.stack ?? String(e)}`));
  process.on("unhandledRejection", (e) => serverEvent(`unhandledRejection: ${(e as Error)?.stack ?? String(e)}`));

  process.on("exit", (code) => serverEvent(`exit - code ${code} after ${uptime()}, ${mem()}`));
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) {
    try {
      process.on(sig, () => {
        serverEvent(`received ${sig} after ${uptime()}`);
        // Next.js handles SIGINT/SIGTERM itself; for the others keep the default (exit)
        if (process.listenerCount(sig) <= 1) process.exit(128);
      });
    } catch {
      /* signal not supported here */
    }
  }

  // a memory reading every 10 minutes shows a leak building up before an out-of-memory crash
  setInterval(() => serverEvent(`alive ${uptime()} - ${mem()}`), 10 * 60_000).unref();

  startCrashMonitor();
}

/**
 * A native crash in Node on Windows leaves nothing behind: libuv calls SetErrorMode
 * (SEM_NOGPFAULTERRORBOX) in every Node process, so Windows Error Reporting is never invoked, and
 * the process ends without an "exit" event or a Node report (AGENTS.md rule 41: six such deaths with
 * 0xC0000409 on Raider18). Only an attached debugger sees it. When Sysinternals ProcDump is installed
 * (%LOCALAPPDATA%\Programs\Sysinternals\procdump64.exe, or MC_PROCDUMP), it is attached to this
 * server at start: one full dump on an unhandled exception or fail-fast, newest 3 kept, in
 * %LOCALAPPDATA%\CrashDumps\node (local disk, never the synced vault). The owner accepted the
 * Sysinternals licence (-accepteula) on 2026-11-27.
 *
 * ProcDump attaches as a DEBUGGER: if it is force-killed, Windows ends this server with it (tested).
 * It is started detached (outside the server's process tree and job), exits by itself when the server
 * does, and nothing here kills it. MC_NO_PROCDUMP=1 turns it off.
 */
function startCrashMonitor(): void {
  if (process.platform !== "win32" || process.env.MC_NO_PROCDUMP === "1") return;
  try {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const exe = process.env.MC_PROCDUMP || path.join(local, "Programs", "Sysinternals", "procdump64.exe");
    if (!fs.existsSync(exe)) return;
    const dir = path.join(local, "CrashDumps", "node");
    fs.mkdirSync(dir, { recursive: true });
    // keep the newest 3 dumps (a full dump of the server is a few hundred MB)
    const dumps = fs
      .readdirSync(dir)
      .filter((n) => n.toLowerCase().endsWith(".dmp"))
      .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const d of dumps.slice(3)) fs.rmSync(path.join(dir, d.n), { force: true });
    const out = fs.openSync(path.join(DATA, "procdump.log"), "w");
    const child = spawn(exe, ["-accepteula", "-e", "-ma", "-n", "1", String(process.pid), dir], { detached: true, stdio: ["ignore", out, out], windowsHide: true });
    child.on("error", (e) => serverEvent(`crash monitor: ProcDump didn't start: ${e.message}`));
    child.unref();
    fs.closeSync(out);
    serverEvent(`crash monitor: ProcDump (pid ${child.pid}) watching this server; a crash leaves a dump in ${dir}`);
  } catch (e) {
    serverEvent(`crash monitor: not started: ${(e as Error).message}`);
  }
}
