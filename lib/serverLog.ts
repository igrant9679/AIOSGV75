import fs from "fs";
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
}
