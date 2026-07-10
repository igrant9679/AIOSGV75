/**
 * OS verb tag patterns. Agents emit these in replies; the store harvests and
 * executes them, then strips the tags from the visible chat and vault logs.
 * The instruction text agents see lives in lib/retrieval.ts (VERB_HINT).
 */
export const REMEMBER_RE = /<remember>([\s\S]*?)<\/remember>/g;
export const GOAL_RE = /<goal>([\s\S]*?)<\/goal>/g;
export const JOURNAL_RE = /<journal>([\s\S]*?)<\/journal>/g;
export const MISSION_RE = /<mission>([\s\S]*?)<\/mission>/g;
