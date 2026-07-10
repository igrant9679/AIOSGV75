import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { startMissionAwaited, type MissionStrategy } from "./missions";
import { recentNotesDigest, todayStamp } from "./vault";

/**
 * Prompt variables, expanded at run time:
 *   {{today}}        → YYYY-MM-DD
 *   {{recent_notes}} → digest of vault notes modified in the last 7 days
 */
async function expandPromptVars(prompt: string): Promise<string> {
  let out = prompt.replace(/\{\{today\}\}/g, todayStamp());
  if (out.includes("{{recent_notes}}")) {
    const digest = await recentNotesDigest();
    out = out.replace("{{recent_notes}}", () => digest);
  }
  return out;
}

/**
 * Scheduled missions: recurring multi-agent runs that fire from the server's
 * background tick (see lib/scheduler.ts + instrumentation.ts). Results are
 * archived to the vault like any mission and can additionally be delivered to
 * Telegram through OpenClaw's message bridge.
 */
export type Frequency = "hourly" | "daily" | "weekly";
export type Delivery = "vault" | "telegram";

export interface Schedule {
  id: string;
  title: string;
  prompt: string;
  strategy: MissionStrategy;
  agentIds: string[];
  synthesizerId?: string;
  freq: Frequency;
  /** "HH:MM" local time — used by daily and weekly */
  time: string;
  /** 0 (Sunday) … 6 — used by weekly */
  weekday?: number;
  deliver: Delivery;
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  lastStatus?: string;
  nextRun: number;
}

const FILE = path.join(process.cwd(), "data", "schedules.json");
const TELEGRAM_TARGET = process.env.TELEGRAM_TARGET ?? "7284896916";

/**
 * No in-memory cache: the scheduler tick (instrumentation bundle) and the API
 * route (route bundle) are separate module instances, so the JSON file is the
 * single source of truth. Every operation is read-modify-write.
 */
const inFlight = new Set<string>();

async function load(): Promise<Schedule[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Schedule[];
  } catch {
    return [];
  }
}

async function save(schedules: Schedule[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(schedules, null, 2), "utf8");
}

export function computeNextRun(s: Pick<Schedule, "freq" | "time" | "weekday">, from = Date.now()): number {
  const base = new Date(from);
  if (s.freq === "hourly") {
    const next = new Date(base);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  const [hh, mm] = (s.time || "09:00").split(":").map((n) => parseInt(n, 10));
  const next = new Date(base);
  next.setHours(hh, mm, 0, 0);
  if (s.freq === "daily") {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // weekly
  const wd = s.weekday ?? 1;
  let delta = (wd - next.getDay() + 7) % 7;
  if (delta === 0 && next.getTime() <= from) delta = 7;
  next.setDate(next.getDate() + delta);
  return next.getTime();
}

export async function listSchedules(): Promise<Schedule[]> {
  return load();
}

let seq = 0;

export async function createSchedule(input: {
  title?: string;
  prompt: string;
  strategy: MissionStrategy;
  agentIds: string[];
  synthesizerId?: string;
  freq: Frequency;
  time: string;
  weekday?: number;
  deliver: Delivery;
}): Promise<Schedule> {
  const schedules = await load();
  const schedule: Schedule = {
    id: `sch-${Date.now().toString(36)}-${seq++}`,
    title: input.title?.trim() || input.prompt.slice(0, 60),
    prompt: input.prompt,
    strategy: input.strategy,
    agentIds: input.agentIds,
    synthesizerId: input.synthesizerId,
    freq: input.freq,
    time: input.time,
    weekday: input.weekday,
    deliver: input.deliver,
    enabled: true,
    createdAt: Date.now(),
    nextRun: computeNextRun(input),
  };
  schedules.push(schedule);
  await save(schedules);
  return schedule;
}

export async function setEnabled(id: string, enabled: boolean): Promise<boolean> {
  const schedules = await load();
  const s = schedules.find((x) => x.id === id);
  if (!s) return false;
  s.enabled = enabled;
  if (enabled) s.nextRun = computeNextRun(s);
  await save(schedules);
  return true;
}

export async function deleteSchedule(id: string): Promise<void> {
  await save((await load()).filter((s) => s.id !== id));
}

function deliverTelegram(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "openclaw",
      ["message", "send", "--channel", "telegram", "--target", TELEGRAM_TARGET, "--message", JSON.stringify(text)],
      { shell: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function runScheduleNow(id: string): Promise<boolean> {
  const s = (await load()).find((x) => x.id === id);
  if (!s || inFlight.has(id)) return false;
  void executeSchedule(s);
  return true;
}

async function patchSchedule(id: string, patch: Partial<Schedule>): Promise<void> {
  const schedules = await load();
  const s = schedules.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  await save(schedules);
}

async function executeSchedule(s: Schedule): Promise<void> {
  if (inFlight.has(s.id)) return;
  inFlight.add(s.id);
  try {
    const mission = await startMissionAwaited({
      title: `⏰ ${s.title}`,
      prompt: await expandPromptVars(s.prompt),
      strategy: s.strategy,
      agentIds: s.agentIds,
      synthesizerId: s.synthesizerId,
    });

    const finalText =
      mission.synthesis?.trim() ||
      mission.results.find((r) => r.status === "done" && r.text.trim())?.text.trim() ||
      "";

    let lastStatus: string;
    if (mission.status !== "done" || !finalText) {
      lastStatus = "mission failed";
    } else if (s.deliver === "telegram") {
      const header = `🛰 Scheduled mission: ${s.title}\n\n`;
      const body = finalText.length > 3500 ? finalText.slice(0, 3500) + "\n…(full result in your vault)" : finalText;
      const sent = await deliverTelegram(header + body);
      lastStatus = sent ? "delivered to Telegram" : "ran, but Telegram delivery failed";
    } else {
      lastStatus = "saved to vault";
    }
    await patchSchedule(s.id, { lastRun: Date.now(), lastStatus });
  } catch (e) {
    await patchSchedule(s.id, { lastRun: Date.now(), lastStatus: `error: ${(e as Error).message.slice(0, 120)}` });
  } finally {
    inFlight.delete(s.id);
  }
}

/** Called by the background tick. Fires every enabled schedule that is due. */
export async function checkDueSchedules(): Promise<void> {
  const schedules = await load();
  const now = Date.now();
  let changed = false;
  const due: Schedule[] = [];
  for (const s of schedules) {
    if (!s.enabled || s.nextRun > now || inFlight.has(s.id)) continue;
    s.nextRun = computeNextRun(s, now); // advance first so a slow run can't double-fire
    changed = true;
    due.push(s);
  }
  if (changed) await save(schedules);
  for (const s of due) void executeSchedule(s);
}
