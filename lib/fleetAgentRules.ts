/**
 * Fleet agents, the pure parts (rule 50; tested by scripts/test-fleet-agents.mjs): what an agent is, the
 * prompt its run gets, when a schedule is due, and the starter templates.
 */

export type AgentTool = "claude" | "codex" | "hermes";
export interface AgentSchedule { freq: "hourly" | "daily" | "weekdays" | "weekly"; time: string; weekday?: number }
export interface AgentRun { at: number; jobId?: string; host?: string; hostLabel?: string; status: "started" | "done" | "failed"; summary?: string; scheduled?: boolean; key?: string; /** machines already tried for this run (Auto placement moves on when one isn't signed in) */ tried?: string[]; note?: string }

/** A failure that means "this machine can't run that tool" (not signed in, not installed), so another machine should be tried. */
export function isSignInFailure(error: string): boolean {
  return /not logged in|please run \/login|run `?\/?login|sign(ed)? ?(in|out)|unauthori[sz]ed|\b401\b|not (installed|recogni[sz]ed)|command not found|no such file/i.test(String(error ?? ""));
}
export interface FleetAgent {
  id: string;
  name: string;
  /** an emoji shown with its name */
  icon: string;
  /** who it is and how it works (its "soul") */
  persona: string;
  /** its standing task */
  task: string;
  tool: AgentTool;
  /** "auto" = the best machine at the time (lib/dispatch.ts), or a machine's host */
  machine: string;
  folder: string;
  access: "answer" | "edit";
  web: boolean;
  /** helpers it may start in one run (0 = works alone) */
  subAgents: number;
  schedule?: AgentSchedule | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  /** the schedule slot already run (so a slot runs once) */
  lastSlot?: string;
  runs: AgentRun[];
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\u0000/g, "").trim().slice(0, n);
const hhmm = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : "08:00");

/** Keep an agent's shape sane (what is saved is only what this returns). Throws with a readable message. */
export function cleanAgent(raw: any, prev?: FleetAgent, now = Date.now()): FleetAgent {
  const name = clip(raw?.name, 60);
  if (!name) throw new Error("Give the agent a name.");
  const task = clip(raw?.task, 4000);
  if (task.length < 8) throw new Error("Say what the agent's task is.");
  const tool: AgentTool = ["claude", "codex", "hermes"].includes(raw?.tool) ? raw.tool : "claude";
  const s = raw?.schedule;
  const schedule: AgentSchedule | null = s && ["hourly", "daily", "weekdays", "weekly"].includes(s.freq) ? { freq: s.freq, time: hhmm(s.time), ...(s.freq === "weekly" ? { weekday: Math.min(6, Math.max(0, Number(s.weekday) || 0)) } : {}) } : null;
  return {
    id: prev?.id ?? `ag-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    icon: clip(raw?.icon, 4) || "🤖",
    persona: clip(raw?.persona, 6000),
    task,
    tool,
    machine: clip(raw?.machine, 80) || "auto",
    folder: clip(raw?.folder, 400) || "~",
    access: raw?.access === "edit" ? "edit" : "answer",
    web: raw?.web !== false,
    subAgents: Math.min(5, Math.max(0, Math.round(Number(raw?.subAgents) || 0))),
    schedule,
    enabled: raw?.enabled !== false,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    lastSlot: prev?.lastSlot,
    runs: prev?.runs ?? [],
  };
}

/** What one run of the agent is told. The persona and task are the owner's own words. */
export function agentPrompt(a: FleetAgent, note?: string): string {
  return [
    `You are "${a.name}", one of the owner's standing agents in Mission Control.`,
    a.persona ? `Who you are and how you work:\n${a.persona}` : "",
    `Your standing task:\n${a.task}`,
    note ? `For this run, the owner adds:\n${note}` : "",
    a.subAgents > 0 ? `You may start up to ${a.subAgents} helper sub-agent${a.subAgents === 1 ? "" : "s"} for separate parts of the job, if your tools allow it; otherwise do the parts yourself, one after the other.` : "Work alone: don't start helper agents.",
    a.web ? "" : "Don't use the web for this.",
    a.access === "edit" ? "You may change files in this folder when the task needs it. Keep changes focused on the task." : "Don't change any files: do the work in writing and put the whole result in your reply.",
    "Anything that would send a message, publish, pay or delete is not yours to do: write the draft and say it waits for the owner's OK.",
    "Finish with the result itself, then one line starting with NEEDS YOU: if something waits on the owner (or NEEDS YOU: nothing).",
  ].filter(Boolean).join("\n\n");
}

/**
 * The schedule slot that is due now, or null. A slot is run once (compare with agent.lastSlot), and only
 * within 6 hours after its time, so a machine that was off all day doesn't run yesterday's jobs at night.
 */
export function dueSlot(s: AgentSchedule | null | undefined, now: Date): string | null {
  if (!s) return null;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (s.freq === "hourly") return `${day}T${String(now.getHours()).padStart(2, "0")}`;
  const dow = now.getDay();
  if (s.freq === "weekdays" && (dow === 0 || dow === 6)) return null;
  if (s.freq === "weekly" && dow !== (s.weekday ?? 1)) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  const at = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3));
  return mins >= at && mins < at + 360 ? `${day}@${s.time}` : null;
}

export function scheduleText(s?: AgentSchedule | null): string {
  if (!s) return "runs when you press Run";
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return s.freq === "hourly" ? "every hour" : s.freq === "daily" ? `every day at ${s.time}` : s.freq === "weekdays" ? `weekdays at ${s.time}` : `${days[s.weekday ?? 1]}s at ${s.time}`;
}

/** Starters: add one, then change anything. */
export const AGENT_TEMPLATES: Pick<FleetAgent, "name" | "icon" | "persona" | "task" | "tool" | "access" | "web" | "subAgents" | "schedule">[] = [
  { name: "Morning Brief", icon: "☀️", tool: "claude", access: "answer", web: false, subAgents: 0, schedule: { freq: "weekdays", time: "07:30" }, persona: "You are a calm chief of staff. You read what is there, say what matters first, and never pad.", task: "Read the shared memory, goals and yesterday's journal in this vault. Write a one-page brief for today: the three things that matter most, what is waiting on the owner, and anything that looks stuck. Plain words, short lines." },
  { name: "Repo Watcher", icon: "🔭", tool: "claude", access: "answer", web: false, subAgents: 2, schedule: { freq: "daily", time: "18:00" }, persona: "You are a careful senior engineer who reads before judging.", task: "In this project folder: run git fetch and compare with the remote, read what changed since yesterday, and report in order: anything broken or risky, what was finished, and what the next sensible step is. Don't change anything." },
  { name: "Research Analyst", icon: "🔎", tool: "claude", access: "answer", web: true, subAgents: 3, schedule: null, persona: "You are a sceptical analyst. You check claims against more than one source and say how sure you are.", task: "Research the question the owner adds for this run. Give the answer first, then the evidence with links, then what is still uncertain." },
  { name: "Draft Writer", icon: "✍️", tool: "claude", access: "answer", web: false, subAgents: 0, schedule: null, persona: "You write the way the owner speaks: direct, warm, no filler. You offer two versions when tone matters.", task: "Write the piece the owner describes for this run (an email, a post, a proposal section). Give a ready-to-send draft, then a shorter alternative. It always waits for the owner's OK." },
  { name: "Fleet Caretaker", icon: "🧰", tool: "claude", access: "answer", web: false, subAgents: 0, schedule: { freq: "weekly", time: "09:00", weekday: 1 }, persona: "You are a tidy operations engineer.", task: "Ask Mission Control for its picture of the fleet (curl -s http://127.0.0.1:3000/api/talos?what=snapshot) and report: machines that are behind on versions or low on memory, schedules that failed, jobs that didn't finish, and plan limits close to full. Say what you would do about each; change nothing." },
];
