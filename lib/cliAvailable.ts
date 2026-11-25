import { spawnSync } from "child_process";

/**
 * "Is this command-line tool installed?" for routing decisions.
 *
 * Same caching rule as agent probes (AGENTS.md rule 2): a yes is kept, a no is
 * only believed for a minute — a tool installed five minutes ago must not stay
 * invisible until the server restarts.
 */
const cache = new Map<string, { ok: boolean; expires: number }>();

export function cliAvailable(name: string): boolean {
  if (!/^[\w.-]+$/.test(name)) return false;
  const hit = cache.get(name);
  if (hit && hit.expires > Date.now()) return hit.ok;
  let ok = false;
  try {
    ok = spawnSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore", windowsHide: true, timeout: 5_000 }).status === 0;
  } catch {
    ok = false;
  }
  cache.set(name, { ok, expires: ok ? Infinity : Date.now() + 60_000 });
  return ok;
}
