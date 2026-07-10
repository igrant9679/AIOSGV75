import os from "os";
import { execFile } from "child_process";

let prevIdle = 0;
let prevTotal = 0;

/** CPU usage since the previous call (Windows-safe; loadavg is 0 there). */
export function cpuUsagePercent(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  const idleDelta = idle - prevIdle;
  const totalDelta = total - prevTotal;
  prevIdle = idle;
  prevTotal = total;
  if (totalDelta <= 0) return 0;
  return Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
}

/**
 * Claude CLI version. Success is cached forever; failure is NOT cached — at
 * cold boot the CLI can take >10s to wake, and a permanently cached failure
 * left the bridge showing offline all day. An in-flight guard stops the 3s
 * system poll from stacking probe processes while one is still running.
 */
let claudeVersionCache: string | null = null;
let probing: Promise<string | null> | null = null;

export function getClaudeVersion(): Promise<string | null> {
  if (claudeVersionCache) return Promise.resolve(claudeVersionCache);
  if (probing) return probing;
  probing = new Promise<string | null>((resolve) => {
    execFile("claude", ["--version"], { shell: true, timeout: 45_000 }, (err, stdout) => {
      const version = err ? null : stdout.trim() || null;
      if (version) claudeVersionCache = version;
      resolve(version);
    });
  }).finally(() => {
    probing = null;
  });
  return probing;
}
