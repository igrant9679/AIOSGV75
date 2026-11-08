import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { cleanEnv } from "./runners";
import { listSchedules } from "./schedules";
import { daemonStatus } from "./daemons";
import { clusterStatus, isMasterNow } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { sendTelegram } from "./telegram";
import { readRemoteSessions, readShareState } from "./sessionShare";

/**
 * Health checks — the things that, when broken, make Mission Control quietly
 * stop working. (2026-11: the Claude CLI login expired and every scheduled
 * job failed for a week with nothing but "mission failed" to show for it.)
 *
 * Each machine checks ITSELF every 10 minutes (not master-gated: a signed-out
 * CLI on a backup node matters the moment it becomes master). Results live in
 * data/health.json, re-read on every call (AGENTS.md rule 1). Telegram alerts
 * are opt-in: one message when a check starts failing, one when it recovers.
 *
 * Read-only toward credentials: `claude auth status` and `codex login status`
 * report sign-in state without spending quota; no login file is opened.
 */

export type HealthLevel = "ok" | "warn" | "fail" | "skip";

export interface HealthCheck {
  id: string;
  label: string;
  level: HealthLevel;
  detail: string;
  /** what to do about it (shown for warn/fail) */
  fix?: string;
  /** what stops working while this is broken */
  impact?: string;
}

export interface HealthReport {
  host: string;
  checkedAt: number;
  ms: number;
  worst: HealthLevel;
  checks: HealthCheck[];
}

interface HealthFile {
  report?: HealthReport;
  settings: { telegram: boolean };
  /** check id → level we last told you about on Telegram */
  notified: Record<string, HealthLevel>;
  lastAlertAt?: number;
}

const FILE = path.join(process.cwd(), "data", "health.json");
const STALE_MS = 10 * 60_000;
const RANK: Record<HealthLevel, number> = { skip: 0, ok: 1, warn: 2, fail: 3 };

export async function readHealthFile(): Promise<HealthFile> {
  try {
    const f = JSON.parse(await fsp.readFile(FILE, "utf8")) as Partial<HealthFile>;
    return { settings: { telegram: false, ...(f.settings ?? {}) }, notified: f.notified ?? {}, report: f.report, lastAlertAt: f.lastAlertAt };
  } catch {
    return { settings: { telegram: false }, notified: {} };
  }
}

async function writeHealthFile(mutate: (f: HealthFile) => void): Promise<HealthFile> {
  const f = await readHealthFile();
  mutate(f);
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(f, null, 2), "utf8");
  await fsp.rename(tmp, FILE);
  return f;
}

export async function setHealthSettings(patch: Partial<HealthFile["settings"]>): Promise<HealthFile["settings"]> {
  const f = await writeHealthFile((h) => {
    h.settings = { ...h.settings, ...patch };
  });
  return f.settings;
}

// ─── helpers ───

function run(cmd: string, args: string[], timeoutMs = 20_000, shell = true): Promise<{ code: number | null; out: string; missing: boolean }> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (code: number | null, missing = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out, missing });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { shell, cwd: os.homedir(), env: cleanEnv(), windowsHide: true });
    } catch {
      resolve({ code: null, out: "", missing: true });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("error", () => finish(null, true));
    child.on("close", (code) => {
      // shell: "'x' is not recognized" / "command not found" → not installed
      finish(code, /is not recognized as an internal or external command|command not found|ENOENT/i.test(out));
    });
  });
}

const fmtAgo = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

// ─── checks ───

async function checkClaude(): Promise<HealthCheck> {
  const base = {
    id: "claude-login",
    label: "Claude Code CLI login",
    impact: "Agents, missions, scheduled jobs, Board and Group with AI can't run Claude on this machine.",
  };
  const r = await run("claude", ["auth", "status", "--json"]);
  if (r.missing) return { ...base, level: "fail", detail: "The claude command isn't installed or isn't on PATH.", fix: "Install Claude Code, then restart Mission Control." };
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf("{"), r.out.lastIndexOf("}") + 1)) as { loggedIn?: boolean; authMethod?: string };
    if (j.loggedIn) return { ...base, level: "ok", detail: `Signed in${j.authMethod && j.authMethod !== "none" ? ` (${j.authMethod})` : ""}.` };
    return {
      ...base,
      level: "fail",
      detail: "Signed out — the login expired or was never set up. The desktop app has its own login, so it can look fine while this is broken.",
      fix: "Open a terminal, run `claude`, type /login and sign in. Then press Re-check.",
    };
  } catch {
    return { ...base, level: "warn", detail: `Couldn't read login status${r.code === null ? " (timed out)" : ""}.`, fix: "Run `claude auth status` in a terminal to see why." };
  }
}

async function checkCodex(): Promise<HealthCheck> {
  const base = { id: "codex-login", label: "Codex CLI login", impact: "Codex workers and the ChatGPT usage meter stop updating." };
  const r = await run("codex", ["login", "status"]);
  if (r.missing) return { ...base, level: "skip", detail: "Codex isn't installed on this machine." };
  if (r.code === 0 && /logged in/i.test(r.out)) {
    const how = r.out.match(/logged in using ([^\r\n]+)/i)?.[1]?.trim();
    return { ...base, level: "ok", detail: `Signed in${how ? ` using ${how}` : ""}.` };
  }
  return { ...base, level: "warn", detail: "Signed out.", fix: "Open a terminal and run `codex login`." };
}

async function checkSchedules(): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const schedules = (await listSchedules().catch(() => [])).filter((s) => s.enabled);
  if (schedules.length === 0) return [{ id: "schedules", label: "Scheduled jobs", level: "skip", detail: "No schedules are enabled." }];

  const failing = schedules.filter((s) => s.lastStatus && /error|fail/i.test(s.lastStatus));
  const isMaster = await isMasterNow().catch(() => true);
  if (!isMaster) {
    // schedules.json is per machine and only the master fires it — results here are history
    const c = await clusterStatus().catch(() => null);
    const master = c?.master ?? "another machine";
    if (!failing.length) return [{ id: "schedules", label: "Scheduled jobs", level: "ok", detail: `Not run here right now — ${master} is master and runs them.` }];
    const last = Math.max(...failing.map((s) => s.lastRun ?? 0));
    return [
      {
        id: "schedules",
        label: "Scheduled jobs",
        level: "warn",
        detail: `${master} runs schedules now. When this machine last ran them (${fmtAgo(last)}), ${failing.length} of ${schedules.length} failed: ${failing[0].lastStatus}`,
        fix: `Fix this machine's login checks before it takes over as master again, and check Health on ${master}.`,
      },
    ];
  }
  if (failing.length) {
    const since = Math.min(...failing.map((s) => s.lastRun ?? Date.now()));
    out.push({
      id: "schedules",
      label: "Scheduled jobs",
      level: "fail",
      detail: `${failing.length} of ${schedules.length} failed on their last run (${failing.map((s) => s.title.replace(/^[^\p{L}\p{N}]+/u, "")).join(", ")}) — oldest failure ${fmtAgo(since)}. ${failing[0].lastStatus}`,
      fix: "Usually a signed-out CLI — fix any login check above, then run one from Schedule → Run now.",
      impact: "Briefs, reports and upkeep jobs aren't being produced.",
    });
  } else {
    out.push({ id: "schedules", label: "Scheduled jobs", level: "ok", detail: `${schedules.length} enabled, all last runs succeeded.` });
  }

  {
    const overdue = schedules.filter((s) => s.nextRun && s.nextRun < Date.now() - 15 * 60_000);
    if (overdue.length) {
      out.push({
        id: "scheduler",
        label: "Scheduler",
        level: "warn",
        detail: `${overdue.length} schedule(s) are more than 15 minutes overdue (${overdue.map((s) => s.title).join(", ")}).`,
        fix: "The schedule tick may be stuck — restart Mission Control (stop.cmd, then the startup launcher).",
      });
    }
  }
  return out;
}

async function checkVault(): Promise<HealthCheck> {
  const base = { id: "vault", label: "Obsidian vault (shared brain)", impact: "Memory, chat logs, journal and cross-machine sync stop." };
  if (await vaultAvailable()) return { ...base, level: "ok", detail: "Reachable." };
  return { ...base, level: "fail", detail: `Can't reach ${vaultInfo().root}.`, fix: "Make sure OneDrive is running and the vault folder is synced to this machine." };
}

async function checkDaemons(): Promise<HealthCheck[]> {
  const list = await daemonStatus().catch(() => []);
  return list
    .filter((d) => d.installed)
    .map((d) =>
      d.running
        ? { id: `daemon-${d.id}`, label: d.label, level: "ok" as const, detail: `Running on port ${d.port}.` }
        : {
            id: `daemon-${d.id}`,
            label: d.label,
            level: "warn" as const,
            detail: `Installed but not answering on port ${d.port}.`,
            fix: `Start it from Settings, or by hand: ${d.manual}`,
          },
    );
}

async function checkWatchdog(): Promise<HealthCheck> {
  const base = { id: "watchdog", label: "Watchdog (auto-restart)", impact: "If the server stops, nothing brings it back until you log in again." };
  if (process.platform !== "win32") return { ...base, level: "skip", detail: "Windows only." };
  try {
    const pause = await fsp.stat(path.join(process.cwd(), "data", "watchdog.pause")).catch(() => null);
    if (pause && Date.now() - pause.mtimeMs < 2 * 3_600_000) {
      return { ...base, level: "warn", detail: `Paused ${fmtAgo(pause.mtimeMs)} (data\\watchdog.pause) — it resumes on its own after 2 hours.`, fix: "Delete data\\watchdog.pause to resume now." };
    }
  } catch {
    /* no pause file */
  }
  const ps =
    "$t = Get-ScheduledTask -TaskName 'Mission Control Watchdog' -ErrorAction SilentlyContinue; " +
    "if (-not $t) { '{\"registered\":false}' } else { $i = $t | Get-ScheduledTaskInfo; " +
    "@{ registered = $true; state = \"$($t.State)\"; lastResult = $i.LastTaskResult; lastRun = $i.LastRunTime.ToString('o') } | ConvertTo-Json -Compress }";
  const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], 20_000, false);
  try {
    const j = JSON.parse(r.out.trim().split(/\r?\n/).pop() ?? "") as { registered: boolean; state?: string; lastResult?: number; lastRun?: string };
    if (!j.registered) return { ...base, level: "warn", detail: "The 5-minute watchdog task isn't registered.", fix: "Run install-watchdog.cmd in the Mission Control folder." };
    if (/disabled/i.test(j.state ?? "")) return { ...base, level: "warn", detail: "The watchdog task is disabled.", fix: "Enable “Mission Control Watchdog” in Task Scheduler, or rerun install-watchdog.cmd." };
    // 0 = success, 267009 = running now, 267011 = not run yet
    if (j.lastResult && ![0, 267009, 267011].includes(j.lastResult)) {
      return { ...base, level: "warn", detail: `Last run returned code ${j.lastResult}.`, fix: "Run `.\\watchdog.ps1 -Status` in PowerShell to see the log." };
    }
    const last = j.lastRun ? Date.parse(j.lastRun) : 0;
    return { ...base, level: "ok", detail: `Registered${last > 0 ? `, last ran ${fmtAgo(last)}` : ""}.` };
  } catch {
    return { ...base, level: "warn", detail: "Couldn't read the watchdog task.", fix: "Run `.\\watchdog.ps1 -Status` in PowerShell." };
  }
}

async function checkCluster(): Promise<HealthCheck | null> {
  const c = await clusterStatus().catch(() => null);
  if (!c || !c.config.enabled) return null;
  const others = c.nodes.filter((n) => !n.self);
  const offline = others.filter((n) => !n.online);
  const base = { id: "cluster", label: "Machine group" };
  if (!c.master) {
    return { ...base, level: "warn", detail: "No machine currently holds the master lease, so schedules and nudges may not be running anywhere.", fix: "Open Settings → Machines and claim master on the machine that should run jobs." };
  }
  if (offline.length) {
    return {
      ...base,
      level: "warn",
      detail: `${offline.length} of ${others.length} other machine(s) offline: ${offline.map((n) => `${n.host} (last seen ${fmtAgo(n.ts)})`).join(", ")}.`,
      fix: "Wake or start Mission Control on them — or remove a retired machine in Settings → Machines.",
    };
  }
  return { ...base, level: "ok", detail: `${others.length + 1} machines online; master is ${c.master}.` };
}

async function checkSharing(): Promise<HealthCheck | null> {
  const c = await clusterStatus().catch(() => null);
  if (!c?.config.enabled) return null;
  const base = { id: "sharing", label: "Session sharing", impact: "Other machines stop seeing this machine's sessions, conversations and tool memory." };
  const [last, remote] = await Promise.all([readShareState(), readRemoteSessions().catch(() => [])]);
  const from = remote.length ? ` Receiving from ${remote.map((r) => r.label || r.host).join(", ")}.` : " No other machine shares yet.";
  if (!last) return { ...base, level: "warn", detail: "This machine hasn't shared yet (it runs every 5 minutes after start-up)." + from };
  if (Date.now() - last.at > 30 * 60_000) {
    return { ...base, level: "warn", detail: `Last shared ${fmtAgo(last.at)}.${from}`, fix: "Check that the vault is reachable, or press Share now on the Fleet page." };
  }
  return { ...base, level: "ok", detail: `Shared ${fmtAgo(last.at)}.${from}` };
}

async function checkDisk(): Promise<HealthCheck> {
  const base = { id: "disk", label: "Free disk space", impact: "Session indexing, logs and builds start failing when the disk fills." };
  try {
    const st = await fsp.statfs(process.cwd());
    const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3;
    const drive = path.parse(process.cwd()).root;
    const detail = `${freeGb.toFixed(1)} GB free on ${drive}`;
    if (freeGb < 1) return { ...base, level: "fail", detail, fix: "Free up space on this drive." };
    if (freeGb < 5) return { ...base, level: "warn", detail, fix: "Free up space soon." };
    return { ...base, level: "ok", detail };
  } catch {
    return { ...base, level: "skip", detail: "Couldn't read free space." };
  }
}

function checkAlertsTransport(enabled: boolean): HealthCheck {
  const viaBot = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasOpenClaw = !viaBot && (process.env.PATH ?? "").split(path.delimiter).some((d) => {
    try {
      return fs.existsSync(path.join(d, "openclaw.cmd")) || fs.existsSync(path.join(d, "openclaw.exe")) || fs.existsSync(path.join(d, "openclaw"));
    } catch {
      return false;
    }
  });
  const base = { id: "alerts", label: "Telegram alerts" };
  if (!enabled) return { ...base, level: "skip", detail: "Off — turn on to get a message when a check starts failing." };
  if (viaBot) return { ...base, level: "ok", detail: "On, sent through the Telegram Bot API." };
  if (hasOpenClaw) return { ...base, level: "ok", detail: "On, sent through OpenClaw." };
  return { ...base, level: "warn", detail: "On, but this machine has no way to send: no TELEGRAM_BOT_TOKEN and no openclaw command.", fix: "Set TELEGRAM_BOT_TOKEN in Mission Control's environment." };
}

// ─── run + alert ───

let running: Promise<HealthReport> | null = null;

export function runHealthChecks(): Promise<HealthReport> {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    const settings = (await readHealthFile()).settings;
    const results = await Promise.all([
      checkClaude(),
      checkCodex(),
      checkSchedules(),
      checkVault(),
      checkDaemons(),
      checkWatchdog(),
      checkCluster(),
      checkSharing(),
      checkDisk(),
    ]);
    const checks = results.flat().filter((c): c is HealthCheck => Boolean(c));
    checks.push(checkAlertsTransport(settings.telegram));
    const worst = checks.reduce<HealthLevel>((w, c) => (RANK[c.level] > RANK[w] ? c.level : w), "ok");
    const report: HealthReport = { host: os.hostname(), checkedAt: Date.now(), ms: Date.now() - started, worst, checks };
    await alertTransitions(report);
    await publishToVault(report).catch(() => {});
    return report;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** One Telegram message per check that starts failing, one when it recovers. */
async function alertTransitions(report: HealthReport): Promise<void> {
  const f = await readHealthFile();
  const toSend: string[] = [];
  const notified = { ...f.notified };
  if (f.settings.telegram) {
    for (const c of report.checks) {
      const was = notified[c.id];
      if (c.level === "fail" && was !== "fail") {
        toSend.push(`⚠️ ${c.label}: ${c.detail}${c.fix ? `\nFix: ${c.fix}` : ""}`);
        notified[c.id] = "fail";
      } else if (c.level !== "fail" && was === "fail" && c.level !== "skip") {
        toSend.push(`✅ ${c.label} is healthy again.`);
        delete notified[c.id];
      }
    }
  }
  let sent = false;
  if (toSend.length) {
    sent = await sendTelegram(`🩺 Mission Control on ${report.host}\n\n${toSend.join("\n\n")}`).catch(() => false);
  }
  await writeHealthFile((h) => {
    h.report = report;
    if (sent) {
      h.notified = notified;
      h.lastAlertAt = Date.now();
    } else if (!h.settings.telegram) {
      h.notified = {}; // alerts off: next time they're turned on, current failures get reported once
    }
  });
}

// ─── machine group: share reports through the vault ───

function healthDir(): string {
  return path.join(vaultInfo().base, "Cluster", "health");
}

/** Other machines read this to show the whole group's health (eventually consistent via OneDrive). */
async function publishToVault(report: HealthReport): Promise<void> {
  const c = await clusterStatus().catch(() => null);
  if (!c?.config.enabled || !(await vaultAvailable())) return;
  await fsp.mkdir(healthDir(), { recursive: true });
  const file = path.join(healthDir(), `${report.host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(report), "utf8");
  await fsp.rename(tmp, file);
}

export interface MachineHealth {
  host: string;
  label: string;
  self: boolean;
  online: boolean;
  isMaster: boolean;
  report?: HealthReport;
}

async function machineGroupHealth(own: HealthReport): Promise<MachineHealth[]> {
  const c = await clusterStatus().catch(() => null);
  if (!c?.config.enabled) return [];
  const out: MachineHealth[] = [];
  for (const n of c.nodes) {
    if (n.self || n.host === own.host) continue;
    let report: HealthReport | undefined;
    try {
      report = JSON.parse(await fsp.readFile(path.join(healthDir(), `${n.host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`), "utf8")) as HealthReport;
    } catch {
      /* that machine hasn't published yet (older Mission Control) */
    }
    out.push({ host: n.host, label: n.label || n.host, self: false, online: n.online, isMaster: c.master === n.host, report });
  }
  out.unshift({ host: own.host, label: c.config.label || own.host, self: true, online: true, isMaster: c.master === own.host, report: own });
  return out;
}

/** Latest report, re-running the checks when it's older than 10 minutes. */
export async function healthSnapshot(
  force = false,
): Promise<{ report: HealthReport; settings: HealthFile["settings"]; lastAlertAt?: number; machines: MachineHealth[] }> {
  const f = await readHealthFile();
  const fresh = f.report && f.report.host === os.hostname() && Date.now() - f.report.checkedAt < STALE_MS;
  const report = !force && fresh ? f.report! : await runHealthChecks();
  const after = await readHealthFile();
  return { report, settings: after.settings, lastAlertAt: after.lastAlertAt, machines: await machineGroupHealth(report) };
}

/** Background tick (every machine, not master-gated): re-check when stale. */
export async function maybeRunHealth(): Promise<void> {
  const f = await readHealthFile();
  if (f.report && f.report.host === os.hostname() && Date.now() - f.report.checkedAt < STALE_MS) return;
  await runHealthChecks();
}
