/**
 * The pure rules behind Work (/work, lib/repoTasks.ts): stable task ids, which repository a git
 * remote points at, and who a task should go to when Mission Control assigns it. No I/O, so
 * scripts/test-repo-tasks.mjs tests it directly.
 */

/** FNV-1a, 64-bit as two 32-bit halves: a short, stable id with no imports. */
export function stableId(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `t${h1.toString(36)}${h2.toString(36)}`;
}

/** The same task written slightly differently keeps its id: case, spacing, markdown and trailing punctuation don't count. */
export function normalizeText(t: string): string {
  return t
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/[.:;,!\s]+$/, "")
    .trim();
}

export const taskId = (repo: string, source: string, text: string) => stableId(`${repo.toLowerCase()}|${source}|${normalizeText(text)}`);

/** "https://github.com/owner/name(.git)" or "git@github.com:owner/name.git" → "owner/name" (lowercase), else null. */
export function repoOfRemote(url: string): string | null {
  const m = String(url).trim().match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/**
 * Things only the owner can do. An instruction that STARTS with one of these verbs is addressed to a
 * person ("Sign in to Gemini", "Paste the three app secrets", "Merge #100"); anywhere else the same word
 * is usually a feature ("Add weekly digest email", "Merge variable resolution"), so it doesn't count.
 * Secrets, passwords and the owner's own accounts count wherever they appear.
 */
const OWNER_START =
  /^(?:\d+\s*[—–.-]\s*)?(sign ?in|log ?in|approve|decide|confirm|reply|respond|paste|enter your|add your|pay|buy|purchase|renew|choose|pick|accept|sign the|upload your|publish (it|the|this|that|your|a|an)|put it live|go live|switch (each|it) on|turn on|run (update|the installer))\b/i;
/**
 * "Merge" / "Review" are the owner's when what follows, within a few words, is a pull request, change,
 * branch, plan or draft ("Merge #100", "Merge Velocity's OpenRouter change", "Review the plan"), not a
 * feature that merely contains the word ("Merge variable live-resolution … job changes").
 */
const OWNER_MERGE = /^(?:\d+\s*[—–.-]\s*)?(merge|review)\s+(?:(?:the|this|that|your|my)\s+)?(?:#\d+|prs?\b|pull requests?\b|(?:[\w'’.#-]+\s+){0,3}(?:changes?|prs?|pull requests?|branch|plan|draft)\b)/i;
/** A secret or account the owner must provide, wherever it's mentioned ("Store the Stripe API key", "add your password"). */
const OWNER_ANYWHERE = /\b(your (account|card|key|login|password|token|api key)|(add|paste|enter|provide|store|set|rotate|create|get) (the |your |a |an )?([\w-]+ ){0,2}(secret|password|credentials?|token|api key)s?|billing|invoice)\b/i;

export type Suggested = { who: "owner"; why: string } | { who: "agent"; why: string } | { who: "nobody"; why: string };

/**
 * Who should do a task, by rules. `owner` = the source addressed it to the owner (a "waiting on you"
 * section, a review asked of them, their PR to merge). Anything else is work an AI in the fleet can
 * take, if some machine has the repository's folder.
 */
export function suggestAssignee(task: { title: string; owner: boolean; sourceKind: string }, hasFolder: boolean): Suggested {
  if (task.owner) return { who: "owner", why: "addressed to you" };
  if (OWNER_START.test(task.title.trim()) || OWNER_MERGE.test(task.title.trim()) || OWNER_ANYWHERE.test(task.title)) return { who: "owner", why: "something only you can do (a sign-in, decision, approval, secret, reply or merge)" };
  if (!hasFolder) return { who: "nobody", why: "no machine in the fleet has this repository's folder" };
  return { who: "agent", why: task.sourceKind === "issue" ? "an open issue: work for an AI in the folder" : "development work: an AI in the repository's folder can take it" };
}

/**
 * Of the places that can take a task, the best: a teammate whose folder is the repository, then this
 * machine, then a LAN machine, then the rest; within each, Claude Code first (it edits safely and can
 * be told answer-only), then Codex.
 */
export function pickPlace<T extends { kind: "teammate" | "machine"; local?: boolean; lan?: boolean; tool?: string }>(places: T[]): T | null {
  const rank = (p: T) => (p.kind === "teammate" ? 0 : p.local ? 1 : p.lan ? 2 : 3) * 10 + (p.tool === "claude" ? 0 : p.tool === "codex" ? 1 : 2);
  return [...places].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}
