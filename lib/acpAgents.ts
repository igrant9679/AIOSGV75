import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import { spawnSync } from "child_process";
import path from "path";
import { cliAvailable } from "./cliAvailable";
import { ACP_AGENT_RE } from "./sessionTools";
import { ACP_PRESETS, presetFor, type AcpAgentInfo } from "./acpPresets";

/**
 * This machine's agents that speak the Agent Client Protocol (data/acp-agents.json).
 *
 * The file is the only place a command for an ACP agent comes from. It is changed through this
 * machine's own page (POST /api/hub/agents-setup, served on 127.0.0.1 only); another machine can
 * name an agent by id and nothing more, and an id that isn't switched on here is refused.
 */

export interface AcpAgent {
  id: string;
  label: string;
  /** a program on PATH, or an absolute path to one */
  command: string;
  args: string[];
  enabled: boolean;
}

const FILE = path.join(process.cwd(), "data", "acp-agents.json");
const ARG_RE = /^[^\r\n\0]{0,200}$/;
const COMMAND_RE = /^[^\r\n\0"<>|&;`$]{1,300}$/;

export async function readAcpAgents(): Promise<AcpAgent[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(FILE, "utf8")) as { agents?: unknown };
    return Array.isArray(raw.agents) ? raw.agents.map(clean).filter((a): a is AcpAgent => a !== null) : [];
  } catch {
    return [];
  }
}

function clean(v: unknown): AcpAgent | null {
  const a = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const id = typeof a.id === "string" ? a.id.trim().toLowerCase() : "";
  const command = typeof a.command === "string" ? a.command.trim() : "";
  const args = Array.isArray(a.args) ? a.args.filter((x): x is string => typeof x === "string" && ARG_RE.test(x)).slice(0, 12) : [];
  if (!ACP_AGENT_RE.test(id) || !COMMAND_RE.test(command)) return null;
  const label = typeof a.label === "string" && a.label.trim() ? a.label.trim().slice(0, 40) : (presetFor(id)?.label ?? id);
  return { id, label, command, args, enabled: a.enabled !== false };
}

/** Replace the whole list (this machine's own page only). Throws on anything it can't accept. */
export async function saveAcpAgents(list: unknown): Promise<AcpAgent[]> {
  if (!Array.isArray(list) || list.length > 20) throw new Error("Expected a list of up to 20 agents.");
  const out: AcpAgent[] = [];
  for (const v of list) {
    const a = clean(v);
    if (!a) throw new Error("Each agent needs an id (lowercase letters, digits, dashes) and a command.");
    if (out.some((x) => x.id === a.id)) throw new Error(`Two agents are called "${a.id}".`);
    out.push(a);
  }
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ agents: out }, null, 2), "utf8");
  await fsp.rename(tmp, FILE);
  return out;
}

/**
 * Where the program is: an absolute path as given, a bare name on PATH, or else in the folders
 * npm, uv / pipx and bun install command-line tools into. Mission Control starts from a scheduled
 * task whose PATH can lack those (Gemini CLI lives in %APPDATA%\npm as gemini.cmd), while the same
 * command works in your terminal. Null = not found.
 */
export function resolveAcpCommand(command: string): string | null {
  if (path.isAbsolute(command)) return fs.existsSync(command) ? command : null;
  if (!/^[\w.-]+$/.test(command)) return null;
  if (process.platform === "win32") {
    // Always an absolute path to something cmd.exe can start. `where` also lists npm's extensionless
    // shell script (`gemini`), which cmd.exe can't run; and the server's PATH may not be your terminal's.
    try {
      const r = spawnSync("where", [command], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
      const hit = (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).find((l) => /\.(exe|cmd|bat)$/i.test(l));
      if (hit) return hit;
    } catch {
      /* fall through to the usual folders */
    }
  } else if (cliAvailable(command)) return command;
  const home = os.homedir();
  const dirs =
    process.platform === "win32"
      ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"), path.join(home, ".local", "bin"), path.join(home, ".bun", "bin")]
      : [path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), path.join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const names = process.platform === "win32" ? [`${command}.cmd`, `${command}.exe`, `${command}.bat`] : [command];
  for (const d of dirs) for (const n of names) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  // Last resort: installed with npm from a terminal INSIDE the Claude desktop app. That app is packaged
  // (MSIX), so its writes to %APPDATA% land in its private folder and only it sees them: `gemini` worked in
  // Claude Code's terminal while Mission Control, started by a scheduled task, had no such file. The files
  // are real, so they run from here; reinstalling from a normal PowerShell is the cleaner fix (the guide says).
  if (process.platform === "win32") {
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Packages");
    try {
      for (const p of fs.readdirSync(pkgs).filter((n) => /^Claude_/i.test(n))) {
        const f = path.join(pkgs, p, "LocalCache", "Roaming", "npm", `${command}.cmd`);
        if (fs.existsSync(f)) return f;
      }
    } catch {
      /* no packaged apps */
    }
  }
  return null;
}

/** Is the program there (see resolveAcpCommand)? */
export function acpInstalled(command: string): boolean {
  return resolveAcpCommand(command) !== null;
}

/** A switched-on agent by id, or undefined. */
export async function findAcpAgent(id: string | undefined): Promise<AcpAgent | undefined> {
  if (!id || !ACP_AGENT_RE.test(id)) return undefined;
  return (await readAcpAgents()).find((a) => a.id === id && a.enabled);
}

/** What other machines are told: id and name of each switched-on, installed agent. Never the command. */
export async function acpAgentInfos(): Promise<AcpAgentInfo[]> {
  return (await readAcpAgents()).filter((a) => a.enabled && acpInstalled(a.command)).map((a) => ({ id: a.id, label: a.label }));
}

/** For the settings panel: the configured agents plus every preset, with whether each is installed here. */
export async function acpOverview(): Promise<{ agents: (AcpAgent & { installed: boolean })[]; presets: (typeof ACP_PRESETS[number] & { installed: boolean; added: boolean })[] }> {
  const agents = await readAcpAgents();
  return {
    agents: agents.map((a) => ({ ...a, installed: acpInstalled(a.command) })),
    presets: ACP_PRESETS.map((p) => ({ ...p, installed: acpInstalled(p.command), added: agents.some((a) => a.id === p.id) })),
  };
}
