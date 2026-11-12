import fsp from "fs/promises";
import os from "os";
import path from "path";

/**
 * Installs / removes Mission Control's session-alert hook (scripts/mc-hook.mjs):
 *
 *  - Claude Code: ~/.claude/settings.json → hooks.Notification / Stop / SessionEnd, and
 *    PermissionRequest (answer permission prompts from the app - lib/permissions.ts)
 *  - Codex:       ~/.codex/config.toml    → notify = ["node", ".../mc-hook.mjs", "codex"]
 *
 * Your own hooks are kept; ours are recognized by "mc-hook.mjs" in the command.
 * A Codex config that already has a notify program of its own is left alone.
 * The original file is backed up once (*.mc-backup) before the first change.
 */

const MARK = "mc-hook.mjs";
const EVENTS = ["Notification", "Stop", "SessionEnd", "PermissionRequest"] as const;
/** PermissionRequest may wait for your answer in the app (lib/permissions.ts) - up to 15 min */
const PERMISSION_TIMEOUT_S = 900;
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");
const CODEX_CONFIG = path.join(os.homedir(), ".codex", "config.toml");

const scriptPath = () => path.join(process.cwd(), "scripts", "mc-hook.mjs").replace(/\\/g, "/");
const claudeCommand = () => `node "${scriptPath()}" claude`;
const permissionCommand = () => `node "${scriptPath()}" permission`;
const commandFor = (ev: (typeof EVENTS)[number]) => (ev === "PermissionRequest" ? permissionCommand() : claudeCommand());

export interface HookStatus {
  claude: "installed" | "missing" | "outdated" | "no-claude";
  codex: "installed" | "missing" | "outdated" | "other-notify" | "no-codex";
  script: string;
}

interface HookEntry {
  type?: string;
  command?: string;
  timeout?: number;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}
type Settings = Record<string, unknown> & { hooks?: Record<string, HookGroup[]> };

async function readJson(file: string): Promise<Settings | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as Settings;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    return null; // unreadable / invalid JSON: never touch it
  }
}

async function backupOnce(file: string): Promise<void> {
  const bak = `${file}.mc-backup`;
  if (await fsp.stat(bak).catch(() => null)) return;
  await fsp.copyFile(file, bak).catch(() => {});
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (await fsp.stat(file).catch(() => null)) await backupOnce(file);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text, "utf8");
  await fsp.rename(tmp, file);
}

const ours = (h: HookEntry) => typeof h.command === "string" && h.command.includes(MARK);

function claudeState(s: Settings): HookStatus["claude"] {
  let found = 0;
  let current = 0;
  for (const ev of EVENTS) {
    const all = (s.hooks?.[ev] ?? []).flatMap((g) => g.hooks ?? []);
    if (all.some(ours)) found++;
    if (all.some((h) => ours(h) && h.command === commandFor(ev))) current++;
  }
  if (found === 0) return "missing";
  return current === EVENTS.length ? "installed" : "outdated";
}

function stripOurs(s: Settings): Settings {
  if (!s.hooks) return s;
  for (const ev of Object.keys(s.hooks)) {
    const groups = (s.hooks[ev] ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ours(h)) }))
      .filter((g) => (g.hooks ?? []).length > 0);
    if (groups.length) s.hooks[ev] = groups;
    else delete s.hooks[ev];
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
  return s;
}

const NOTIFY_RE = /^\s*notify\s*=.*$/m;
const codexLine = () => `notify = ["node", "${scriptPath()}", "codex"]`;

function codexState(text: string | null): HookStatus["codex"] {
  if (text === null) return "no-codex";
  const m = text.match(NOTIFY_RE);
  if (!m) return "missing";
  if (!m[0].includes(MARK)) return "other-notify";
  return m[0].trim() === codexLine() ? "installed" : "outdated";
}

export async function hookStatus(): Promise<HookStatus> {
  const claudeDir = await fsp.stat(path.dirname(CLAUDE_SETTINGS)).catch(() => null);
  const s = claudeDir ? await readJson(CLAUDE_SETTINGS) : null;
  const codexDir = await fsp.stat(path.dirname(CODEX_CONFIG)).catch(() => null);
  const toml = codexDir ? await fsp.readFile(CODEX_CONFIG, "utf8").catch(() => "") : null;
  return { claude: !claudeDir ? "no-claude" : s ? claudeState(s) : "missing", codex: codexState(toml), script: scriptPath() };
}

/** Add (or refresh) our hooks. Returns what changed. */
export async function installHooks(): Promise<HookStatus> {
  // Claude Code
  if (await fsp.stat(path.dirname(CLAUDE_SETTINGS)).catch(() => null)) {
    const s = await readJson(CLAUDE_SETTINGS);
    if (s && claudeState(s) !== "installed") {
      stripOurs(s);
      s.hooks ??= {};
      for (const ev of EVENTS) {
        (s.hooks[ev] ??= []).push({ hooks: [{ type: "command", command: commandFor(ev), timeout: ev === "PermissionRequest" ? PERMISSION_TIMEOUT_S : 5 }] });
      }
      await writeAtomic(CLAUDE_SETTINGS, JSON.stringify(s, null, 2) + "\n");
    }
  }
  // Codex: notify must be a top-level key, so it goes above the first [table]
  if (await fsp.stat(path.dirname(CODEX_CONFIG)).catch(() => null)) {
    const text = await fsp.readFile(CODEX_CONFIG, "utf8").catch(() => "");
    const st = codexState(text);
    if (st === "missing" || st === "outdated") {
      const nl = text.includes("\r\n") ? "\r\n" : "\n";
      const without = text.replace(NOTIFY_RE, "").replace(/^(\r?\n)+/, "");
      await writeAtomic(CODEX_CONFIG, `${codexLine()}${nl}${without}`);
    }
  }
  return hookStatus();
}

/** Remove only our hooks. */
export async function removeHooks(): Promise<HookStatus> {
  const s = await readJson(CLAUDE_SETTINGS);
  if (s && claudeState(s) !== "missing") await writeAtomic(CLAUDE_SETTINGS, JSON.stringify(stripOurs(s), null, 2) + "\n");
  const text = await fsp.readFile(CODEX_CONFIG, "utf8").catch(() => null);
  if (text !== null && codexState(text) !== "missing" && codexState(text) !== "other-notify") {
    await writeAtomic(CODEX_CONFIG, text.replace(/^\s*notify\s*=.*mc-hook\.mjs.*(\r?\n)?/m, ""));
  }
  return hookStatus();
}
