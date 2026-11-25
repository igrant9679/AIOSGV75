/**
 * The tools whose native sessions Mission Control can list, read, reply to and
 * start — on this machine and, through the machine group, on the others.
 *
 * ONE place to add a tool. Before this file the code asked "is it Claude?" in
 * about fifty places and treated every other answer as Codex, so a third tool
 * would have been labelled, resumed and billed as Codex without any error.
 * Use these helpers instead of comparing against "claude".
 *
 * Client-safe: no fs, no child_process — pages import it for labels.
 *
 * Adding a tool (Gemini CLI, Kimi CLI, …) means: an entry here, a reader for
 * its sessions (see lib/hermesSessions.ts for the pattern), and a branch in
 * execute() in lib/sessionActions.ts that runs it. Nothing else should need to
 * know the tool exists.
 */
export type SessionTool = "claude" | "codex" | "hermes";

export interface SessionToolInfo {
  id: SessionTool;
  /** full name, e.g. in a session's header: "Claude Code" */
  label: string;
  /** short name, e.g. on a button: "Send to Claude" */
  short: string;
  /** what a run is charged to, completing "…with your ___" */
  runsOn: string;
  /** the command a person types to continue a session in a terminal */
  resume: (id: string) => string;
  /** program name, for "is it installed" checks and opening a terminal */
  cli: string;
  /** can continue an open session as a separate branch, so two writers can't collide */
  canFork: boolean;
  /** sessions can be moved to another machine (handoff) */
  canMove: boolean;
  /** live view: has a process list / hooks that say whether a session is waiting on you */
  hasLiveStatus: boolean;
}

export const SESSION_TOOLS: Record<SessionTool, SessionToolInfo> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    short: "Claude",
    runsOn: "Claude subscription",
    resume: (id) => `claude --resume ${id}`,
    cli: "claude",
    canFork: true,
    canMove: true,
    hasLiveStatus: true,
  },
  codex: {
    id: "codex",
    label: "Codex",
    short: "Codex",
    runsOn: "ChatGPT subscription",
    resume: (id) => `codex resume ${id}`,
    cli: "codex",
    canFork: false,
    canMove: false,
    hasLiveStatus: false,
  },
  hermes: {
    id: "hermes",
    label: "Hermes",
    short: "Hermes",
    // Hermes signs in to a provider of its own (Nous Portal, or an OAuth plan picked in `hermes model`)
    runsOn: "Hermes sign-in",
    resume: (id) => `hermes --resume ${id}`,
    cli: "hermes",
    canFork: false,
    canMove: false,
    hasLiveStatus: false,
  },
};

export const SESSION_TOOL_IDS = Object.keys(SESSION_TOOLS) as SessionTool[];

/** A session key is "<tool>:<id>". Built from the registry, so a new tool's keys are accepted everywhere at once. */
export const SESSION_KEY_RE = new RegExp(`^(${SESSION_TOOL_IDS.join("|")}):[\\w.-]+$`);

export function toolOfKey(key: string): SessionTool | undefined {
  const tool = key.slice(0, key.indexOf(":"));
  return isSessionTool(tool) ? tool : undefined;
}

export function isSessionTool(v: unknown): v is SessionTool {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SESSION_TOOLS, v);
}

/** For request bodies: a known tool, or the fallback — never a silent "everything else is Codex". */
export function asSessionTool(v: unknown, fallback: SessionTool = "claude"): SessionTool {
  return isSessionTool(v) ? v : fallback;
}

export const toolLabel = (tool: string): string => (isSessionTool(tool) ? SESSION_TOOLS[tool].label : tool);
export const toolShort = (tool: string): string => (isSessionTool(tool) ? SESSION_TOOLS[tool].short : tool);
export const toolRunsOn = (tool: string): string => (isSessionTool(tool) ? SESSION_TOOLS[tool].runsOn : "sign-in");
export const resumeCommand = (tool: string, id: string): string => (isSessionTool(tool) ? SESSION_TOOLS[tool].resume(id) : "");

/**
 * Hermes toolsets a run from Mission Control may use. Hermes's non-interactive
 * modes cannot stop and ask, so what a run is ALLOWED to do is decided by which
 * toolsets are switched on (an explicit list replaces the configured one).
 * Neither level can run commands, drive a browser or the desktop, schedule
 * jobs or spawn sub-agents.
 *
 * "answer" also leaves out `skills`: that toolset includes skill_manage, which
 * writes skill files — a change on disk, which Answer only promises not to make.
 * Verified on a real run: asked to create a file, an answer-level session
 * replied that it had no tool that could and listed only web / memory / todo /
 * vision / session_search tools.
 */
export const HERMES_TOOLSETS: Record<"answer" | "edit", string> = {
  answer: "web,vision,todo,memory,session_search",
  edit: "web,vision,todo,memory,session_search,skills,file",
};

/**
 * The toolsets for one run. `web: false` leaves the web toolset out: Hermes's
 * web search goes through Nous's Tool Gateway, so a task that doesn't need the
 * internet shouldn't be able to spend on it, and a free model given no web tool
 * can't wander off searching. Undefined keeps the default (web on).
 */
export function hermesToolsets(access: "answer" | "edit", web?: boolean): string {
  const sets = HERMES_TOOLSETS[access].split(",");
  return (web === false ? sets.filter((s) => s !== "web") : sets).join(",");
}
