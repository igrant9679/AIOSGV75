import { spawn } from "child_process";
import net from "net";
import fs from "fs";

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
      // --skip-build serves the pre-built UI immediately (the default rebuilds
      // the web UI first, which hangs in a non-interactive spawn); --no-open
      // stops it from launching a browser.
      args: ["dashboard", "--skip-build", "--no-open"],
      manual: "hermes dashboard --skip-build --no-open",
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

function launch(d: Daemon): void {
  const child = spawn(d.bin, d.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {}); // swallow ENOENT etc. — best-effort
  child.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Start a daemon on demand (from the UI). Waits briefly for the port to come up. */
export async function startDaemon(id: string): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  const d = findDaemon(id);
  if (!d) return { ok: false, error: "unknown service" };
  if (await checkPort(d.port)) return { ok: true, already: true };
  if (!isInstalled(d)) return { ok: false, error: `${d.label} isn't installed on this machine (${d.bin}).` };
  try {
    launch(d);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  for (let i = 0; i < 12; i++) {
    await sleep(700);
    if (await checkPort(d.port)) return { ok: true };
  }
  return { ok: false, error: `${d.label} was launched but port ${d.port} hasn't come up yet — give it a moment and refresh.` };
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

/** Boot hook: start every installed daemon that isn't already up. Best-effort. */
export async function ensureDaemons(): Promise<void> {
  for (const d of daemonList()) {
    try {
      if (!isInstalled(d)) continue;
      if (await checkPort(d.port)) continue;
      launch(d);
    } catch {
      /* best effort — never let a daemon failure break boot */
    }
  }
}
