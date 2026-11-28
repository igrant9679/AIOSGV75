/**
 * The Hub's "Auto" (rule 49): which of the three ways a request in the one box should go. Pure, so it is
 * tested (scripts/test-hub.mjs) and the Hub can show its choice before sending, with a one-click change.
 *   fleet → Mission Control answers or proposes a change (lib/talos.ts commandFleet, confirm cards)
 *   agent → a real session on a machine (it can read and, if allowed, change files)
 *   chat  → an answer from the best available model (lib/router.ts)
 */
export type HubRoute = "fleet" | "agent" | "chat";

const FLEET = /\b(fleet|machines?|computers?|sessions?|jobs?|runs?|schedules?|approv\w*|pause|resume|updat\w* (all|the|every)? ?(machines?|fleet)|level ?up|hand-?offs?|waiting on (me|you)|limits?|work tasks?|open tasks?|tasks? (on|across|assigned)|github|talos|jarvis|mission control|online|offline|legion7|raider18|area51|winai5|sabine|what('?s| is) running|status)\b/i;
const DO = /^(please\s+)?(fix|build|implement|refactor|create|write|add|update|debug|test|review|rename|migrate|install|run|deploy|clean up|investigate|find out why|look into|audit|scaffold|generate)\b/i;
const CODE = /\b(repo(sitory)?|code(base)?|files?|folders?|bugs?|functions?|components?|pages?|scripts?|projects?|branch(es)?|commits?|tests?|builds?|api|endpoint|database|css|typescript|python|package|dependenc\w+|readme|pull request|pr)\b/i;

export function hubRoute(text: string): { route: HubRoute; why: string } {
  const t = text.trim();
  if (!t) return { route: "chat", why: "" };
  if (DO.test(t) && CODE.test(t)) return { route: "agent", why: "it asks for work on code or files" };
  if (FLEET.test(t)) return { route: "fleet", why: "it is about your fleet or its work" };
  if (DO.test(t) && t.length > 160) return { route: "agent", why: "it is a longer job" };
  return { route: "chat", why: "it is a question" };
}
