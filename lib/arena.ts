import fs from "fs/promises";
import path from "path";

/** Arena leaderboard: win tallies from head-to-head model battles. */
const FILE = path.join(process.cwd(), "data", "arena.json");

export interface ArenaStanding {
  agentId: string;
  wins: number;
  battles: number;
}

interface ArenaData {
  standings: Record<string, { wins: number; battles: number }>;
  votes: { ts: number; winner: string; participants: string[]; prompt: string }[];
}

async function load(): Promise<ArenaData> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as ArenaData;
  } catch {
    return { standings: {}, votes: [] };
  }
}

async function save(data: ArenaData): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listStandings(): Promise<ArenaStanding[]> {
  const data = await load();
  return Object.entries(data.standings)
    .map(([agentId, s]) => ({ agentId, ...s }))
    .sort((a, b) => b.wins / Math.max(1, b.battles) - a.wins / Math.max(1, a.battles) || b.wins - a.wins);
}

export async function recordVote(winner: string, participants: string[], prompt: string): Promise<void> {
  const data = await load();
  for (const id of participants) {
    data.standings[id] ??= { wins: 0, battles: 0 };
    data.standings[id].battles++;
    if (id === winner) data.standings[id].wins++;
  }
  data.votes.push({ ts: Date.now(), winner, participants, prompt: prompt.slice(0, 200) });
  data.votes = data.votes.slice(-500);
  await save(data);
}
