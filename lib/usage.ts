import fs from "fs/promises";
import path from "path";

/**
 * Usage ledger: one record per agent run (chats, missions, schedules,
 * summarizers). Feeds the Analytics page today and smart routing later.
 * File is the source of truth — no module cache (multiple bundle instances).
 */
export interface UsageEntry {
  ts: number;
  agent: string;
  kind: "chat" | "mission" | "system";
  ms: number;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  ok: boolean;
}

const FILE = path.join(process.cwd(), "data", "usage.json");
const MAX_ENTRIES = 8000;

export async function readUsage(days?: number): Promise<UsageEntry[]> {
  let entries: UsageEntry[] = [];
  try {
    entries = JSON.parse(await fs.readFile(FILE, "utf8")) as UsageEntry[];
  } catch {
    return [];
  }
  if (!days) return entries;
  const cutoff = Date.now() - days * 86_400_000;
  return entries.filter((e) => e.ts >= cutoff);
}

export async function recordUsage(entry: UsageEntry): Promise<void> {
  const entries = await readUsage();
  entries.push(entry);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(entries.slice(-MAX_ENTRIES)), "utf8");
}
