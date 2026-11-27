import path from "path";

/**
 * What an ACP agent run from Mission Control may do: pure rules, tested by scripts/test-acp.mjs.
 *
 * An ACP agent asks before acting (session/request_permission, with the kind of tool call:
 * read, edit, delete, move, search, execute, think, fetch, switch_mode, other) and may read and
 * write files through us (fs/read_text_file, fs/write_text_file). Mission Control answers for
 * you, the same way it limits Claude Code:
 *
 *   answer  read, search, think and fetch (web) are allowed; everything else is refused
 *   edit    also edit and move files; delete, running commands and anything unknown are refused
 *
 * Only ever "allow once": an "always" answer can be written into the agent's own settings and
 * would outlive this run. If the agent offers no one-off allow, the call is refused.
 *
 * What it can't cover: an agent that acts without asking (its own settings may approve some tools
 * automatically) is not stopped by this. The guide says so.
 */

export type AcpAccess = "answer" | "edit";

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export type PermissionOutcome = { outcome: "selected"; optionId: string } | { outcome: "cancelled" };

const ALLOWED: Record<AcpAccess, string[]> = {
  answer: ["read", "search", "think", "fetch"],
  edit: ["read", "search", "think", "fetch", "edit", "move"],
};

export function mayRun(kind: string | undefined, access: AcpAccess): boolean {
  return ALLOWED[access].includes(kind ?? "other");
}

/** The answer to a permission request, and whether it was a yes. */
export function permissionChoice(kind: string | undefined, access: AcpAccess, options: PermissionOption[]): { allowed: boolean; outcome: PermissionOutcome } {
  const opts = Array.isArray(options) ? options : [];
  if (mayRun(kind, access)) {
    const once = opts.find((o) => o.kind === "allow_once");
    if (once) return { allowed: true, outcome: { outcome: "selected", optionId: once.optionId } };
  }
  // a one-off "no" where there is one; "always reject" would also be written into the agent's settings
  const no = opts.find((o) => o.kind === "reject_once");
  return { allowed: false, outcome: no ? { outcome: "selected", optionId: no.optionId } : { outcome: "cancelled" } };
}

/**
 * Is `p` inside `root`? Relative paths are taken from `root`. Case-insensitive on Windows, where
 * C:\Users and c:\users are the same folder. ".." that climbs out, and another drive, are outside.
 */
export function insideFolder(root: string, p: string, platform: string = process.platform): boolean {
  if (typeof p !== "string" || !p || p.includes("\0")) return false;
  const lib = platform === "win32" ? path.win32 : path.posix;
  const r = lib.resolve(root);
  const t = lib.resolve(r, p);
  const norm = (s: string) => (platform === "win32" ? s.toLowerCase() : s);
  const rel = lib.relative(norm(r), norm(t));
  return rel === "" || (!rel.startsWith("..") && !lib.isAbsolute(rel));
}

/** "Sign in" errors from an agent that isn't signed in, so the reply can say how to fix it. */
export function looksSignedOut(text: string): boolean {
  return /api key is missing|not configured|authenticat|log ?in required|please (log|sign) ?in|unauthori[sz]ed|not logged in|no credentials/i.test(text);
}
