import fs from "fs/promises";
import path from "path";
import { readUserProfile, writeUserProfile, readGoals, readJournal, todayStamp } from "./vault";
import { listExchanges } from "./conversations";
import { readTasks } from "./tasks";
import { runAgentText } from "./runners";

/**
 * The fleet-wide user profile: a maintained "who you are working with" note,
 * refreshed on a schedule and injected into EVERY agent via
 * `memorySystemBlock()` in retrieval.ts.
 *
 * This is Mission Control's answer to a per-agent memory layer like Honcho.
 * The trade is deliberate: no dialectic reasoning passes and no per-agent
 * isolation, but one shared profile that Claude, Talos, Hermes, Codex, Auto
 * and every registry LLM all see — and it runs on a subscription at $0 rather
 * than making an LLM call every couple of turns forever.
 *
 * Two hard constraints shaped the design:
 *  - A schedule CANNOT do this alone. OS verbs (`<remember>`) are harvested
 *    from chat replies only; mission outputs are deliberately never harvested
 *    (anti-recursion), and schedule delivery only targets vault/telegram. So
 *    the write path has to be explicit, which is what this module is.
 *  - The output rides on every prompt the fleet sends. An invented trait would
 *    become a persistent, self-reinforcing lie, so the prompt demands evidence
 *    and the result is hard-capped.
 */

/** Injected on every agent call — every character here is paid for repeatedly. */
export const PROFILE_MAX_CHARS = 1200;
/** A profile that churns daily is noise; a week is enough for real change. */
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Throttle + last-outcome state. Per rule 1 this file is the source of truth —
 *  the scheduler (instrumentation bundle) and the API route are separate module
 *  instances, so an in-memory timestamp in one is invisible to the other. */
const STATE_FILE = path.join(process.cwd(), "data", "user-profile.json");

export interface ProfileState {
  lastRun?: number;
  lastStatus?: string;
  lastChars?: number;
  writer?: string;
}

export async function readProfileState(): Promise<ProfileState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as ProfileState;
  } catch {
    return {};
  }
}

async function writeProfileState(s: ProfileState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
}

/** Guards against a slow refresh overlapping the next 30s tick in THIS process.
 *  (Cross-process is handled by the timestamp in STATE_FILE.) */
let inFlight = false;

/**
 * Called from the scheduler tick. Self-throttling to weekly, like maybeRescan().
 * Master-gated by the caller, so exactly one machine in a group refreshes.
 */
export async function maybeRefreshProfile(): Promise<void> {
  if (inFlight) return;
  const state = await readProfileState();
  if (state.lastRun && Date.now() - state.lastRun < REFRESH_INTERVAL_MS) return;

  inFlight = true;
  try {
    // refreshUserProfile stamps the state itself (so manual runs count too).
    await refreshUserProfile(state.writer || "claude");
  } catch (e) {
    await writeProfileState({ lastRun: Date.now(), lastStatus: `failed · ${(e as Error).message}`, writer: state.writer });
  } finally {
    inFlight = false;
  }
}
/** How much source material the writer sees. Generous; it runs weekly. */
const SOURCE_BUDGET = 12_000;
const RECENT_EXCHANGES = 40;
const JOURNAL_DAYS = 14;

export interface ProfileRefresh {
  ok: boolean;
  chars?: number;
  profile?: string;
  /** true when the writer overran the cap and a compression pass was run. */
  compressed?: boolean;
  /** true when even the compression overran and the tail was cut. */
  truncated?: boolean;
  error?: string;
  sources?: { chats: number; goals: number; journalDays: number; tasks: number };
}

/** Strip a whole-answer code fence some models add despite the instruction. */
function clean(s: string): string {
  return s
    .trim()
    .replace(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/m, "$1")
    .trim();
}

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

/** Assemble the evidence the writer is allowed to reason from. */
async function gatherSources() {
  const [exchanges, goals, tasks] = await Promise.all([
    listExchanges().catch(() => []),
    readGoals().catch(() => []),
    readTasks().catch(() => ({ tasks: [], preamble: "" })),
  ]);

  // Imported history is ~1,500 records and would drown 17 real chats — and it's
  // a distillation of old ChatGPT/Claude use, not how the fleet is used now.
  const chats = exchanges.filter((e) => e.kind !== "history").slice(-RECENT_EXCHANGES);

  const journalParts: string[] = [];
  let journalDays = 0;
  try {
    const { dates } = await readJournal(todayStamp());
    for (const d of dates.slice(-JOURNAL_DAYS).reverse()) {
      const { content } = await readJournal(d);
      if (content.trim()) {
        journalParts.push(`--- ${d} ---\n${clip(content, 900)}`);
        journalDays++;
      }
    }
  } catch {
    /* no journal yet */
  }

  const chatText = chats
    .map((e) => `[${e.date} · ${e.agent}] user: ${clip(e.userText || "", 400)}`)
    .join("\n");

  const goalText = goals.map((g) => `- [${g.done ? "x" : " "}] ${g.text}`).join("\n");
  const taskText = tasks.tasks.map((t) => `- (${t.status}) ${t.title}`).join("\n");

  const blocks = [
    chatText && `## What they actually asked their agents (most recent ${chats.length})\n${chatText}`,
    goalText && `## Goals\n${goalText}`,
    taskText && `## Task board\n${taskText}`,
    journalParts.length > 0 && `## Journal (last ${journalDays} entries)\n${journalParts.join("\n\n")}`,
  ].filter(Boolean) as string[];

  return {
    text: clip(blocks.join("\n\n"), SOURCE_BUDGET),
    counts: { chats: chats.length, goals: goals.length, journalDays, tasks: tasks.tasks.length },
  };
}

function buildPrompt(existing: string, sources: string): string {
  return `You maintain the user profile for Idris's AI fleet. What you write is injected into the system prompt of EVERY agent he talks to, so it must be true, useful, and short.

${existing.trim() ? `Here is the CURRENT profile. Merge, don't restart — keep what still holds, revise what changed, and DELETE anything the evidence below now contradicts:\n\n${existing.trim()}` : "There is no profile yet. Write the first one."}

EVIDENCE — this is the only thing you may reason from:

${sources}

Rules, in order of importance:
1. Every line must be traceable to the evidence above. Do NOT infer personality, mood, or psychology. If you cannot point to something he actually did or said, leave it out.
2. Be specific and useful to an agent about to answer him. "Prefers verification over assertion — asks for proof that a fix worked" beats "values quality".
3. If there is not enough signal for a section, write "not enough signal yet" under it. An honest short profile is far better than a padded one — this text is injected everywhere, so a wrong line becomes a lie every agent repeats.
4. HARD LIMIT ${PROFILE_MAX_CHARS} characters total. Ruthless.
5. Output ONLY the profile markdown. No preamble, no commentary, no code fences.

Use exactly these sections:

## How he works
## Current focus
## Preferences & conventions
## Avoid`;
}

export async function refreshUserProfile(writerAgentId = "claude"): Promise<ProfileRefresh> {
  const { text: sources, counts } = await gatherSources();
  if (!sources.trim()) {
    const err = "no source material yet — no chats, goals, tasks or journal entries found";
    await writeProfileState({ lastRun: Date.now(), lastStatus: `failed · ${err}`, writer: writerAgentId });
    return { ok: false, error: err };
  }

  const existing = await readUserProfile();
  // Strip our own header before showing it back, so the writer merges the body
  // rather than treating the generated banner as evidence about the user.
  const existingBody = existing
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#\s+User Profile[^\n]*\s*/, "")
    .replace(/^>[^\n]*\n?/gm, "")
    .trim();

  const run = await runAgentText(writerAgentId, buildPrompt(existingBody, sources));
  if (run.error || !run.text.trim()) {
    const err = run.error || "writer returned nothing";
    await writeProfileState({ lastRun: Date.now(), lastStatus: `failed · ${err}`, writer: writerAgentId });
    return { ok: false, error: err, sources: counts };
  }

  let body = clean(run.text);

  // Models are poor at counting characters, and a blind slice amputates whole
  // sections mid-sentence (the first run lost "## Avoid" entirely). Ask once for
  // a compression — it runs weekly, so one extra call is cheap — and only fall
  // back to cutting if that also overruns.
  let compressed = false;
  if (body.length > PROFILE_MAX_CHARS) {
    const retry = await runAgentText(
      writerAgentId,
      `This profile is ${body.length} characters; the hard limit is ${PROFILE_MAX_CHARS}. Rewrite it under the limit, keeping ALL FOUR sections — cut the least-load-bearing details, never a whole section. Output only the markdown.\n\n${body}`,
    );
    if (!retry.error && retry.text.trim()) {
      const shorter = clean(retry.text);
      if (shorter.length < body.length) {
        body = shorter;
        compressed = true;
      }
    }
  }
  let truncated = false;
  if (body.length > PROFILE_MAX_CHARS) {
    truncated = true;
    // Cut at the last clean break inside budget rather than mid-word.
    const cut = body.slice(0, PROFILE_MAX_CHARS - 1);
    const brk = Math.max(cut.lastIndexOf("\n## "), cut.lastIndexOf("\n- "), cut.lastIndexOf("\n"));
    body = `${(brk > PROFILE_MAX_CHARS * 0.5 ? cut.slice(0, brk) : cut).trim()}…`;
  }

  const note = `---
date: ${todayStamp()}
tags: [agentic-os, user-profile]
---

# User Profile

> Maintained automatically from chats, goals, tasks and journal — rewritten each
> refresh, not appended. Injected into every agent's system prompt, so it is
> capped at ${PROFILE_MAX_CHARS} characters. Edit it by hand if something is wrong;
> the next refresh will merge your correction rather than discard it.

${body}
`;
  await writeUserProfile(note);
  await writeProfileState({
    lastRun: Date.now(),
    lastStatus: `updated · ${body.length} chars`,
    lastChars: body.length,
    writer: writerAgentId,
  });
  return { ok: true, chars: body.length, profile: body, sources: counts, compressed, truncated };
}
