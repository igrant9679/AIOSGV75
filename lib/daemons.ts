import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";

/**
 * Local service supervisor. Some app features depend on companion daemons that
 * aren't Mission Control itself — chiefly the Hermes dashboard (Control Room)
 * and Ollama (local models + embeddings). This module checks whether each is
 * listening and can start it, and `ensureDaemons()` (called from
 * instrumentation.ts at server boot) brings up any that are down.
 *
 * Because the Mission Control server already auto-starts at Windows login
 * (Startup → server.cmd), wiring dependency startup here means a single boot of
 * the app also brings up everything it needs — including after a system restart.
 * Everything is best-effort: a missing binary is skipped silently, and spawned
 * daemons are detached + unref'd so they outlive the app process.
 */
export interface Daemon {
  id: string;
  label: string;
  detail: string;
  port: number;
  bin: string;
  args: string[];
  /** How the operator would start it by hand (shown in the UI). */
  manual: string;
  /**
   * Slower, self-healing args used only when `args` fails to open the port —
   * e.g. build the web UI first instead of assuming a prebuilt one exists.
   */
  fallbackArgs?: string[];
  fallbackNote?: string;
}

function daemonList(): Daemon[] {
  const list: Daemon[] = [];
  const hermesBin = process.env.HERMES_BIN;
  if (hermesBin) {
    list.push({
      id: "hermes-dashboard",
      label: "Hermes Dashboard",
      detail: "Powers the Control Room",
      port: 9119,
      bin: hermesBin,
      // --skip-build serves the pre-built UI immediately (~4s). It's the fast
      // path, but it assumes the UI has been built at least once — on a fresh
      // install (or after something clears the build) there's nothing to serve
      // and 9119 never opens, so we fall back to a real build below.
      args: ["dashboard", "--skip-build", "--no-open"],
      manual: "hermes dashboard --skip-build --no-open",
      fallbackArgs: ["dashboard", "--no-open"],
      fallbackNote: "building its web UI (first run after install) — this takes a few minutes",
    });
  }
  list.push({
    id: "ollama",
    label: "Ollama",
    detail: "Local models + semantic embeddings",
    port: 11434,
    bin: process.env.OLLAMA_BIN ?? "ollama",
    args: ["serve"],
    manual: "ollama serve",
  });
  return list;
}

export function findDaemon(id: string): Daemon | undefined {
  return daemonList().find((d) => d.id === id);
}

/** True if something is listening on 127.0.0.1:port. */
export function checkPort(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, "127.0.0.1");
  });
}

/** An absolute-path binary that doesn't exist → treat as not installed. */
function isInstalled(d: Daemon): boolean {
  const looksLikePath = d.bin.includes("\\") || d.bin.includes("/");
  return looksLikePath ? fs.existsSync(d.bin) : true; // bare command: assume it's on PATH
}

/**
 * Spawn a daemon detached so it outlives this process. Output goes to
 * data/<id>.log rather than /dev/null: when a daemon fails to open its port
 * the log is the only evidence of why (these failures are otherwise silent).
 */
function launch(d: Daemon, args = d.args): void {
  let stdio: "ignore" | ["ignore", number, number] = "ignore";
  try {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(path.join(dir, `${d.id}.log`), "a");
    stdio = ["ignore", fd, fd];
  } catch {
    /* logging is a nicety — fall back to ignore */
  }
  const child = spawn(d.bin, args, { detached: true, stdio, windowsHide: true });
  child.on("error", () => {}); // swallow ENOENT etc. — best-effort
  child.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait up to `tries * 700ms` for a daemon's port to open. */
async function waitForPort(d: Daemon, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await sleep(700);
    if (await checkPort(d.port)) return true;
  }
  return false;
}

/**
 * In-process guard so we don't stack multiple slow rebuilds of the same
 * daemon. Note instrumentation.ts and route handlers are separate module
 * instances, so this only dedupes within one of them — the port re-check
 * before each spawn is what prevents real duplicates.
 */
const building = new Set<string>();

/**
 * Start a daemon on demand (from the UI). Tries the fast path, and if the port
 * doesn't open, kicks off the slow self-healing path (e.g. build the UI) in the
 * background and reports `building` — the caller shouldn't block for minutes.
 */
export async function startDaemon(
  id: string,
): Promise<{ ok: boolean; already?: boolean; building?: boolean; error?: string }> {
  const d = findDaemon(id);
  if (!d) return { ok: false, error: "unknown service" };
  if (await checkPort(d.port)) return { ok: true, already: true };
  if (!isInstalled(d)) return { ok: false, error: `${d.label} isn't installed on this machine (${d.bin}).` };
  try {
    launch(d);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (await waitForPort(d, 12)) return { ok: true };

  // Fast path didn't open the port. Retry with the slower args that fix the
  // usual cause (no prebuilt UI) — it can take minutes, so don't wait on it.
  if (d.fallbackArgs && !building.has(d.id)) {
    building.add(d.id);
    try {
      launch(d, d.fallbackArgs);
    } catch {
      /* reported below */
    }
    void (async () => {
      await waitForPort(d, 430); // ~5 min
      building.delete(d.id);
    })();
    return {
      ok: false,
      building: true,
      error: `${d.label} is ${d.fallbackNote ?? "starting the slow way"}. Leave this page open and refresh in a few minutes — it only happens once.`,
    };
  }
  return {
    ok: false,
    error: building.has(d.id)
      ? `${d.label} is already building — refresh in a few minutes.`
      : `${d.label} was launched but port ${d.port} hasn't come up yet. See data/${d.id}.log.`,
  };
}

/** Redacted status list for the UI. */
export async function daemonStatus() {
  return Promise.all(
    daemonList().map(async (d) => ({
      id: d.id,
      label: d.label,
      detail: d.detail,
      port: d.port,
      manual: d.manual,
      installed: isInstalled(d),
      running: await checkPort(d.port),
    })),
  );
}

/**
 * Boot hook: start every installed daemon that isn't already up. Best-effort,
 * and self-healing — if the fast path doesn't open the port we retry with the
 * slower fallback args, so a machine whose prebuilt UI is missing (fresh
 * install, or a reboot that cleared it) repairs itself instead of showing
 * "not running" forever.
 */
export async function ensureDaemons(): Promise<void> {
  for (const d of daemonList()) {
    try {
      if (!isInstalled(d)) continue;
      if (await checkPort(d.port)) continue;
      launch(d);
      if (!d.fallbackArgs) continue;
      // Don't hold up boot — verify and repair in the background.
      void (async () => {
        if (await waitForPort(d, 12)) return;
        if (await checkPort(d.port)) return;
        building.add(d.id);
        try {
          launch(d, d.fallbackArgs!);
          await waitForPort(d, 430); // ~5 min for a UI build
        } finally {
          building.delete(d.id);
        }
      })();
    } catch {
      /* best effort — never let a daemon failure break boot */
    }
  }
}
