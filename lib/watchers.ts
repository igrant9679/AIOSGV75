import fs from "fs/promises";
import path from "path";
import { startMissionAwaited } from "./missions";
import { readGoals, readMemory } from "./vault";
import { sendTelegram } from "./telegram";

/**
 * Event-driven automations: the scheduler tick checks each watcher's trigger
 * and fires a mission when something changed. First check only baselines
 * state (no firing on pre-existing files/goals/lines).
 */
export type WatcherType = "file" | "goal_done" | "memory_mention";

export interface Watcher {
  id: string;
  name: string;
  type: WatcherType;
  /** file: folder path · memory_mention: keyword · goal_done: none */
  config: { path?: string; keyword?: string };
  /** mission prompt; {{event}} is replaced with what happened */
  prompt: string;
  agentId: string;
  notify: boolean;
  enabled: boolean;
  cooldownMin: number;
  lastFired?: number;
  lastEvent?: string;
  state?: { known?: string[]; count?: number };
}

const FILE = path.join(process.cwd(), "data", "watchers.json");
const inFlight = new Set<string>();

async function load(): Promise<Watcher[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Watcher[];
  } catch {
    return [];
  }
}

async function save(watchers: Watcher[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(watchers, null, 2), "utf8");
}

export async function listWatchers(): Promise<Watcher[]> {
  return load();
}

let seq = 0;

export async function createWatcher(input: {
  name: string;
  type: WatcherType;
  config: { path?: string; keyword?: string };
  prompt: string;
  agentId: string;
  notify: boolean;
  cooldownMin?: number;
}): Promise<Watcher> {
  const watchers = await load();
  const watcher: Watcher = {
    id: `w-${Date.now().toString(36)}${seq++}`,
    name: input.name.slice(0, 60),
    type: input.type,
    config: input.config,
    prompt: input.prompt.slice(0, 2000),
    agentId: input.agentId,
    notify: input.notify,
    enabled: true,
    cooldownMin: Math.max(1, input.cooldownMin ?? 10),
  };
  watchers.push(watcher);
  await save(watchers);
  return watcher;
}

export async function setWatcherEnabled(id: string, enabled: boolean): Promise<boolean> {
  const watchers = await load();
  const w = watchers.find((x) => x.id === id);
  if (!w) return false;
  w.enabled = enabled;
  await save(watchers);
  return true;
}

export async function deleteWatcher(id: string): Promise<void> {
  await save((await load()).filter((w) => w.id !== id));
}

/** Returns the event description if the trigger fired, updating state in place. */
async function checkTrigger(w: Watcher): Promise<string | null> {
  if (w.type === "file") {
    const dir = w.config.path ?? "";
    let names: string[] = [];
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return null; // folder missing/unreadable — stay quiet
    }
    if (!w.state?.known) {
      w.state = { known: names }; // baseline, no fire
      return null;
    }
    const fresh = names.filter((n) => !w.state!.known!.includes(n));
    w.state.known = names;
    return fresh.length > 0 ? `New file${fresh.length > 1 ? "s" : ""} in ${dir}: ${fresh.slice(0, 10).join(", ")}` : null;
  }

  if (w.type === "goal_done") {
    const done = (await readGoals()).filter((t) => t.done).map((t) => t.text);
    if (!w.state?.known) {
      w.state = { known: done };
      return null;
    }
    const fresh = done.filter((t) => !w.state!.known!.includes(t));
    w.state.known = done;
    return fresh.length > 0 ? `Goal completed: ${fresh.join("; ").slice(0, 300)}` : null;
  }

  if (w.type === "memory_mention") {
    const lines = (await readMemory()).split(/\r?\n/).filter((l) => l.trim().startsWith("- "));
    const prev = w.state?.count ?? -1;
    w.state = { count: lines.length };
    if (prev < 0) return null; // baseline
    const fresh = lines.slice(prev);
    const keyword = (w.config.keyword ?? "").toLowerCase();
    const hit = fresh.find((l) => !keyword || l.toLowerCase().includes(keyword));
    return hit ? `New shared memory${keyword ? ` mentioning "${w.config.keyword}"` : ""}: ${hit.slice(0, 300)}` : null;
  }

  return null;
}

export async function checkWatchers(): Promise<void> {
  const watchers = await load();
  let dirty = false;

  for (const w of watchers) {
    if (!w.enabled || inFlight.has(w.id)) continue;
    if (w.lastFired && Date.now() - w.lastFired < w.cooldownMin * 60_000) continue;

    const event = await checkTrigger(w);
    dirty = true; // state baselines/updates
    if (!event) continue;

    w.lastFired = Date.now();
    w.lastEvent = event.slice(0, 300);
    inFlight.add(w.id);
    void (async () => {
      try {
        const mission = await startMissionAwaited({
          title: `👁 ${w.name}`,
          prompt: w.prompt.replaceAll("{{event}}", event),
          strategy: "single",
          agentIds: [w.agentId || "auto"],
        });
        if (w.notify) {
          const text =
            mission.results[0]?.text?.trim() || mission.results[0]?.error || "(no output)";
          await sendTelegram(`👁 Watcher "${w.name}" fired\n${event}\n\n${text.slice(0, 3000)}`);
        }
      } catch {
        /* mission failure is visible in the mission log */
      } finally {
        inFlight.delete(w.id);
      }
    })();
  }

  if (dirty) await save(watchers);
}
