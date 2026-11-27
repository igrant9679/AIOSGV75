/**
 * "When a plan hits its limit, carry on with another tool": the pure rules, tested by
 * scripts/test-fallback.mjs. The doing is lib/fallback.ts and execute() in lib/sessionActions.ts.
 *
 * A step is a session tool ("claude", "codex", "hermes"), an ACP agent ("acp:gemini") or "local"
 * (this machine's local model: answers only, no session, nothing written).
 */

export type FallbackStep = string;

export const STEP_RE = /^(claude|codex|hermes|local|acp:[a-z0-9][a-z0-9-]{0,31})$/;

export const DEFAULT_ORDER: FallbackStep[] = ["claude", "codex", "local"];

/**
 * Does this error mean "no more allowance right now" (or the provider is overloaded), rather than
 * a mistake in the task? Only these move a conversation to another tool; any other error is
 * reported as it is.
 */
export function isLimitError(text: string | undefined): boolean {
  if (!text) return false;
  return /usage limit|limit reached|hit your [\w\s-]{0,24}limit|session limit|weekly limit|rate[_ -]?limit|quota|resource[_ ]exhausted|\b429\b|too many requests|out of (credits|tokens)|insufficient (balance|credit|quota)|overloaded|\b529\b|capacity/i.test(text);
}

/** The steps to try after `from`, in the owner's order, that suit this run. */
export function nextSteps(order: FallbackStep[], from: FallbackStep, access: "answer" | "edit", tried: FallbackStep[] = []): FallbackStep[] {
  const seen = new Set([from, ...tried]);
  return order.filter((s) => STEP_RE.test(s) && !seen.has(s) && !(s === "local" && access === "edit")).filter((s, i, a) => a.indexOf(s) === i);
}

export interface CarryEntry {
  kind: "user" | "assistant" | "tool" | "note";
  text?: string;
  summary?: string;
}

/**
 * The first message to the tool taking over: who it is replacing and why, the conversation so far
 * (newest kept when it has to be shortened, and said so: AGENTS.md rule 18), and the message to
 * act on now. `max` is the whole prompt's budget; a local model gets a small one.
 */
export function handoffPrompt(o: { fromLabel: string; reason: string; entries: CarryEntry[]; message: string; folder?: string; max: number }): string {
  const head = [
    `You are taking over a conversation that was running in ${o.fromLabel}, which can't continue right now (${o.reason}).`,
    o.folder ? `You are working in the same folder: ${o.folder}.` : "",
    "Below is the conversation so far, then the latest message. Carry on from where it left off: answer or act on the latest message as the previous assistant would have. Don't repeat the history back.",
  ]
    .filter(Boolean)
    .join("\n");
  const tail = `\n\n=== Latest message (act on this) ===\n${o.message}`;
  const room = o.max - head.length - tail.length - 200;
  const lines: string[] = [];
  let used = 0;
  let dropped = 0;
  for (let i = o.entries.length - 1; i >= 0; i--) {
    const e = o.entries[i];
    const line =
      e.kind === "user" ? `USER: ${e.text ?? ""}` : e.kind === "assistant" ? `ASSISTANT: ${e.text ?? ""}` : e.kind === "tool" ? `[tool used: ${e.summary ?? ""}]` : `(${e.text ?? ""})`;
    const clipped = line.length > 4000 ? `${line.slice(0, 4000)} …(this message was shortened by ${"Mission Control"})` : line;
    if (used + clipped.length + 1 > room) {
      dropped = i + 1;
      break;
    }
    lines.unshift(clipped);
    used += clipped.length + 1;
  }
  // the latest message is often the last USER entry already; don't show it twice
  if (lines.length && lines[lines.length - 1] === `USER: ${o.message}`) lines.pop();
  const history = lines.length
    ? `\n\n=== Conversation so far${dropped ? ` (the ${dropped} oldest entries were left out by Mission Control to fit)` : ""} ===\n${lines.join("\n")}`
    : "\n\n(No earlier conversation could be read.)";
  return head + history + tail;
}

export const stepLabel = (s: FallbackStep, labels: Record<string, string> = {}): string =>
  labels[s] ?? (s === "claude" ? "Claude Code" : s === "codex" ? "Codex" : s === "hermes" ? "Hermes" : s === "local" ? "the local model" : s.startsWith("acp:") ? s.slice(4) : s);
