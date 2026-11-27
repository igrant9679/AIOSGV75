import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { cleanEnv } from "./runners";
import { listMcpServers } from "./mcp";
import { skillHash } from "./skillCopy";

/**
 * Fleet → Setup: what each machine's AI tools are set up with, side by side.
 *
 *   Agentic OS/Cluster/setup/<host>.json   (one per machine, written by it, every 15 minutes)
 *
 * NAMES AND VERSIONS ONLY. An MCP server's arguments, environment and headers can hold API keys,
 * so only its name, kind and the file name of its command leave this machine. Skills and plugins
 * by name; CLAUDE.md / AGENTS.md by size and a short hash (to spot copies that differ).
 *
 * Changes go through the official CLIs, never by editing Claude's files behind its back (Claude
 * Code rewrites ~/.claude.json all the time):
 *   - an MCP server of your own is "turned off" by saving its definition in data/mcp-parked.json
 *     (this machine only; it can hold keys, like data/registry.json) and `claude mcp remove -s user`;
 *     turned back on with `claude mcp add-json -s user`, exactly as it was;
 *   - a plugin (and with it its MCP servers and skills) with `claude plugin disable / enable`.
 * Sessions already running keep what they started with; new sessions get the change.
 */

export interface SetupMcp {
  name: string;
  /** "user" = your own (~/.claude.json), "plugin" = comes with a plugin, "mission-control" = data/mcp.json */
  source: "user" | "plugin" | "mission-control";
  plugin?: string;
  kind: string;
  /** file name of the command (or the URL's host): never its arguments */
  command?: string;
  enabled: boolean;
  /** turned off from Fleet → Setup (its definition waits in data/mcp-parked.json) */
  parked?: boolean;
}

export interface SetupPlugin {
  id: string;
  version?: string;
  enabled: boolean;
  mcp: string[];
  skills: string[];
}

export interface MachineSetup {
  v: 1;
  host: string;
  label: string;
  at: number;
  clis: { name: string; version?: string }[];
  mcp: SetupMcp[];
  /** skills in ~/.claude/skills (plugin skills are listed under their plugin) */
  skills: string[];
  /** a fingerprint of each of those skills' contents, so a copy that differs shows (lib/skillCopy.ts) */
  skillHashes?: Record<string, string>;
  /** models in this machine's Ollama (names and sizes only); missing = Ollama isn't running here */
  ollamaModels?: { name: string; gb: number }[];
  plugins: SetupPlugin[];
  /** Claude Code hooks: event → how many */
  hooks: Record<string, number>;
  claudeMd?: { bytes: number; hash: string };
  codexAgentsMd?: { bytes: number; hash: string };
}

const HOME = os.homedir();
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const CLAUDE_DIR = path.join(HOME, ".claude");
const PARKED_FILE = path.join(process.cwd(), "data", "mcp-parked.json");
const CLI_CACHE = path.join(process.cwd(), "data", "setup-clis.json");
const CLI_TTL_MS = 6 * 60 * 60_000;
const PUBLISH_EVERY_MS = 15 * 60_000;
export const SETUP_NAME_RE = /^[\w@.:-]{1,100}$/;

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
};

const fingerprint = (file: string) => {
  try {
    const b = fs.readFileSync(file);
    return { bytes: b.length, hash: crypto.createHash("sha1").update(b).digest("hex").slice(0, 10) };
  } catch {
    return undefined;
  }
};

function commandName(v: { command?: unknown; url?: unknown }): string | undefined {
  if (typeof v.url === "string") {
    try {
      return new URL(v.url).host;
    } catch {
      return undefined;
    }
  }
  return typeof v.command === "string" ? path.basename(v.command) : undefined;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let child: ReturnType<typeof spawn>;
    try {
      // shell on Windows for .cmd shims (codex, gemini); the arguments here are fixed or checked names
      child = spawn(cmd, args, { windowsHide: true, env: cleanEnv(), shell: process.platform === "win32" && !/\.exe$/i.test(cmd) });
    } catch {
      return resolve({ code: -1, out: "" });
    }
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(t);
      resolve({ code: -1, out });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, out: out.trim() });
    });
  });
}

/** The claude executable: the native install first (no shell needed for JSON arguments). */
function claudeBin(): string {
  const native = path.join(HOME, ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  return fs.existsSync(native) ? native : "claude";
}

const CLIS: { name: string; cmd: string; args: string[] }[] = [
  { name: "Claude Code", cmd: "claude", args: ["--version"] },
  { name: "Codex", cmd: "codex", args: ["--version"] },
  { name: "Hermes", cmd: process.env.HERMES_BIN || "hermes", args: ["--version"] },
  { name: "Gemini", cmd: "gemini", args: ["--version"] },
  { name: "Ollama", cmd: "ollama", args: ["--version"] },
  { name: "Node", cmd: "node", args: ["--version"] },
  { name: "Git", cmd: "git", args: ["--version"] },
];

/** Versions of the CLIs (cached 6 hours: a cold Hermes or Gemini start can take many seconds). */
async function cliVersions(force = false): Promise<MachineSetup["clis"]> {
  const cached = readJson<{ at: number; clis: MachineSetup["clis"] }>(CLI_CACHE);
  if (cached && !force && Date.now() - cached.at < CLI_TTL_MS) return cached.clis;
  const clis = await Promise.all(
    CLIS.map(async (c) => {
      const cmd = c.name === "Claude Code" ? claudeBin() : c.cmd;
      const r = await run(cmd, c.args, 30_000);
      const m = r.code === 0 ? r.out.match(/\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?/) : null;
      return { name: c.name, version: m ? m[0] : undefined };
    }),
  );
  try {
    fs.writeFileSync(CLI_CACHE, JSON.stringify({ at: Date.now(), clis }), "utf8");
  } catch {
    /* next time */
  }
  return clis;
}

interface Parked {
  [name: string]: { config: Record<string, unknown>; at: number };
}
const readParked = (): Parked => readJson<Parked>(PARKED_FILE) ?? {};
const writeParked = (p: Parked) => {
  fs.mkdirSync(path.dirname(PARKED_FILE), { recursive: true });
  fs.writeFileSync(PARKED_FILE, JSON.stringify(p, null, 2), "utf8");
};

/** This machine's setup, read now. */
export async function collectSetup(forceClis = false): Promise<MachineSetup> {
  const cfg = await readConfig().catch(() => null);
  const claudeJson = readJson<{ mcpServers?: Record<string, { type?: string; command?: string; url?: string }> }>(CLAUDE_JSON);
  const settings = readJson<{ enabledPlugins?: Record<string, boolean>; hooks?: Record<string, unknown[]> }>(path.join(CLAUDE_DIR, "settings.json"));
  const installed = readJson<{ plugins?: Record<string, { installPath?: string; version?: string }[]> }>(path.join(CLAUDE_DIR, "plugins", "installed_plugins.json"));

  const mcp: SetupMcp[] = Object.entries(claudeJson?.mcpServers ?? {}).map(([name, v]) => ({
    name,
    source: "user",
    kind: v.type || (v.url ? "http" : "stdio"),
    command: commandName(v),
    enabled: true,
  }));
  for (const [name, p] of Object.entries(readParked())) {
    if (mcp.some((m) => m.source === "user" && m.name === name)) continue; // added back by hand: it is on
    mcp.push({ name, source: "user", kind: String(p.config.type || (p.config.url ? "http" : "stdio")), command: commandName(p.config), enabled: false, parked: true });
  }

  const plugins: SetupPlugin[] = [];
  for (const [id, installs] of Object.entries(installed?.plugins ?? {})) {
    const inst = installs?.[0];
    const dir = inst?.installPath ?? "";
    const enabled = settings?.enabledPlugins?.[id] !== false && Boolean(settings?.enabledPlugins && id in settings.enabledPlugins);
    const pm = readJson<{ mcpServers?: Record<string, { type?: string; command?: string; url?: string }> }>(path.join(dir, ".mcp.json"))?.mcpServers ?? {};
    const skillsDir = path.join(dir, "skills");
    const skills = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir).filter((s) => fs.existsSync(path.join(skillsDir, s, "SKILL.md"))) : [];
    plugins.push({ id, version: inst?.version, enabled, mcp: Object.keys(pm), skills });
    for (const [name, v] of Object.entries(pm)) mcp.push({ name, source: "plugin", plugin: id, kind: v.type || (v.url ? "http" : "stdio"), command: commandName(v), enabled });
  }
  for (const s of await listMcpServers().catch(() => [])) mcp.push({ name: s.name, source: "mission-control", kind: s.transport, enabled: true });

  const skillsRoot = path.join(CLAUDE_DIR, "skills");
  const skills = fs.existsSync(skillsRoot)
    ? fs
        .readdirSync(skillsRoot)
        .filter((s) => fs.existsSync(path.join(skillsRoot, s, "SKILL.md")))
        .sort()
    : [];

  return {
    v: 1,
    host: os.hostname(),
    label: cfg?.label || os.hostname(),
    at: Date.now(),
    clis: await cliVersions(forceClis),
    mcp,
    skills,
    skillHashes: skillHashes(skills),
    ollamaModels: await ollamaModels(),
    plugins,
    hooks: Object.fromEntries(Object.entries(settings?.hooks ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
    claudeMd: fingerprint(path.join(CLAUDE_DIR, "CLAUDE.md")),
    codexAgentsMd: fingerprint(path.join(HOME, ".codex", "AGENTS.md")),
  };
}

/** Skill fingerprints, cached 10 minutes (each one reads the whole skill folder). */
let hashCache: { at: number; v: Record<string, string> } | null = null;
function skillHashes(skills: string[]): Record<string, string> {
  if (hashCache && Date.now() - hashCache.at < 10 * 60_000 && skills.every((s) => s in hashCache!.v)) return hashCache.v;
  const v: Record<string, string> = {};
  for (const s of skills) {
    const h = skillHash(s);
    if (h) v[s] = h;
  }
  hashCache = { at: Date.now(), v };
  return v;
}

/** The models this machine's Ollama has (its own API on localhost; nothing leaves the machine). */
async function ollamaModels(): Promise<{ name: string; gb: number }[] | undefined> {
  try {
    const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(2_000) });
    if (!r.ok) return undefined;
    const b = (await r.json()) as { models?: { name?: string; size?: number }[] };
    return (b.models ?? [])
      .filter((m) => typeof m.name === "string")
      .map((m) => ({ name: m.name!, gb: Math.round(((m.size ?? 0) / 1e9) * 10) / 10 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return undefined;
  }
}

// ─── sharing ───

const dir = () => path.join(vaultInfo().base, "Cluster", "setup");
const fileFor = (host: string) => path.join(dir(), `${host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);

let lastPublish = 0;
/** Write this machine's setup to the vault (every 15 minutes from the scheduler, or right after a change). */
export async function publishSetup(force = false): Promise<MachineSetup | null> {
  if (!force && Date.now() - lastPublish < PUBLISH_EVERY_MS) return null;
  const cfg = await readConfig().catch(() => null);
  if (!cfg?.enabled || !(await vaultAvailable())) return null;
  lastPublish = Date.now();
  const s = await collectSetup();
  await fsp.mkdir(dir(), { recursive: true });
  const tmp = `${fileFor(s.host)}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(s), "utf8");
  await fsp.rename(tmp, fileFor(s.host)).catch(async () => {
    await new Promise((r) => setTimeout(r, 500));
    await fsp.rename(tmp, fileFor(s.host));
  });
  return s;
}

/** Every machine's setup: this one read now, the others from their vault files. */
export async function allSetups(): Promise<MachineSetup[]> {
  const mine = await collectSetup();
  const out = [mine];
  const names = await fsp.readdir(dir()).catch(() => [] as string[]);
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const s = JSON.parse(await fsp.readFile(path.join(dir(), n), "utf8")) as MachineSetup;
      if (s?.host && s.host.toLowerCase() !== mine.host.toLowerCase() && Array.isArray(s.mcp)) out.push(s);
    } catch {
      /* mid-sync */
    }
  }
  return out;
}

// ─── changes (this machine only; another machine's request arrives as a job, lib/sessionActions.ts) ───

/** "skill-install" carries a packed skill with it (lib/skillCopy.ts); the others name what to switch. */
export type SetupAction = "mcp-off" | "mcp-on" | "plugin-off" | "plugin-on" | "skill-install";
export const SETUP_ACTIONS: SetupAction[] = ["mcp-off", "mcp-on", "plugin-off", "plugin-on", "skill-install"];

/**
 * Apply one change here. The target is checked against this machine's own setup, never taken on
 * trust from a request. Returns a sentence for the job's reply.
 */
export async function applySetupAction(action: SetupAction, target: string): Promise<string> {
  if (!SETUP_ACTIONS.includes(action) || !SETUP_NAME_RE.test(target)) throw new Error("bad setup change");
  if (action === "skill-install") throw new Error("A skill copy needs the skill itself (lib/skillCopy.ts).");
  const s = await collectSetup();
  const bin = claudeBin();
  if (action === "mcp-off") {
    const claudeJson = readJson<{ mcpServers?: Record<string, Record<string, unknown>> }>(CLAUDE_JSON);
    const config = claudeJson?.mcpServers?.[target];
    if (!config) {
      if (s.mcp.some((m) => m.name === target && m.source === "plugin")) throw new Error(`${target} comes with a plugin: turn the plugin off instead.`);
      throw new Error(`No MCP server of your own called ${target} on this machine.`);
    }
    // save it FIRST, so a failed remove loses nothing
    writeParked({ ...readParked(), [target]: { config, at: Date.now() } });
    const r = await run(bin, ["mcp", "remove", target, "-s", "user"], 60_000);
    if (r.code !== 0) throw new Error(`claude mcp remove failed: ${r.out.slice(-200)}`);
    void publishSetup(true).catch(() => {});
    return `Turned off ${target}. New Claude sessions here won't start it; sessions already open keep theirs until they end. Turn it back on any time; its settings are kept on this machine.`;
  }
  if (action === "mcp-on") {
    const p = readParked()[target];
    if (!p) throw new Error(`${target} wasn't turned off from here, so there is nothing to restore.`);
    const r = await run(bin, ["mcp", "add-json", target, JSON.stringify(p.config), "-s", "user"], 60_000);
    if (r.code !== 0 && !/already exists/i.test(r.out)) throw new Error(`claude mcp add-json failed: ${r.out.slice(-200)}`);
    const rest = readParked();
    delete rest[target];
    writeParked(rest);
    void publishSetup(true).catch(() => {});
    return `Turned ${target} back on, as it was. New Claude sessions here start it again.`;
  }
  const plugin = s.plugins.find((p) => p.id === target);
  if (!plugin) throw new Error(`No plugin called ${target} on this machine.`);
  const on = action === "plugin-on";
  const r = await run(bin, ["plugin", on ? "enable" : "disable", target, "-s", "user"], 60_000);
  if (r.code !== 0 && !/already (enabled|disabled)/i.test(r.out)) throw new Error(`claude plugin ${on ? "enable" : "disable"} failed: ${r.out.slice(-200)}`);
  void publishSetup(true).catch(() => {});
  const what = [plugin.mcp.length ? `MCP server${plugin.mcp.length > 1 ? "s" : ""} ${plugin.mcp.join(", ")}` : "", plugin.skills.length ? `${plugin.skills.length} skill${plugin.skills.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ");
  return on ? `Turned ${target} back on${what ? ` (${what})` : ""} for new Claude sessions here.` : `Turned ${target} off${what ? `, and with it its ${what}` : ""}, for new Claude sessions here. Sessions already open keep it until they end.`;
}
