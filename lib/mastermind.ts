import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";

/**
 * AI Agent Mastermind: a group chat where every agent is a different real
 * model. Agents reply IN TURN (sequential round-robin) so each one sees the
 * replies before it and can riff or push back. Tag @agent to ask just them.
 * Same persistence discipline as missions: data file is the source of truth,
 * per-chat read-modify-write, live overlay for in-flight rounds.
 */
export interface MastermindTurn {
  role: "user" | "agent";
  agentId?: string;
  text: string;
  ts: number;
  error?: string;
}

export interface MastermindChat {
  id: string;
  title: string;
  roomIds: string[];
  status: "idle" | "running";
  /** agent currently composing (UI typing indicator) */
  speaking?: string;
  createdAt: number;
  updatedAt: number;
  turns: MastermindTurn[];
}

const FILE = path.join(process.cwd(), "data", "mastermind.json");
const MAX_CHATS = 30;
const MAX_TURNS = 400;
const STALE_MS = 15 * 60_000;

const live = new Map<string, MastermindChat>();

async function readDisk(): Promise<MastermindChat[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as MastermindChat[];
  } catch {
    return [];
  }
}

export async function listChats(): Promise<MastermindChat[]> {
  const disk = await readDisk();
  const merged = disk.map((c) => {
    const mine = live.get(c.id);
    if (mine) return mine;
    if (c.status === "running" && Date.now() - c.updatedAt > STALE_MS) {
      c.status = "idle";
      c.speaking = undefined;
    }
    return c;
  });
  for (const c of live.values()) if (!merged.some((x) => x.id === c.id)) merged.unshift(c);
  return merged.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<MastermindChat | null> {
  return (await listChats()).find((c) => c.id === id) ?? null;
}

async function save(chat: MastermindChat): Promise<void> {
  const disk = await readDisk();
  const i = disk.findIndex((c) => c.id === chat.id);
  if (i >= 0) disk[i] = chat;
  else disk.unshift(chat);
  disk.sort((a, b) => b.updatedAt - a.updatedAt);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(disk.slice(0, MAX_CHATS), null, 2), "utf8");
}

export async function deleteChat(id: string): Promise<void> {
  live.delete(id);
  const disk = (await readDisk()).filter((c) => c.id !== id);
  await fs.writeFile(FILE, JSON.stringify(disk, null, 2), "utf8");
}

let seq = 0;

export async function createChat(roomIds: string[]): Promise<MastermindChat> {
  const chat: MastermindChat = {
    id: `mm-${Date.now().toString(36)}-${seq++}`,
    title: "New mastermind",
    roomIds,
    status: "idle",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    turns: [],
  };
  await save(chat);
  return chat;
}

/** "@claude what do you think" → ["claude"]; no mentions → [] (whole room). */
export function parseMentions(message: string, roomIds: string[]): string[] {
  const found = new Set<string>();
  for (const m of message.matchAll(/@([a-z0-9_-]+)/gi)) {
    const id = m[1].toLowerCase();
    const hit = roomIds.find((r) => r.toLowerCase() === id || r.toLowerCase().startsWith(id));
    if (hit) found.add(hit);
  }
  return Array.from(found);
}

function agentPrompt(chat: MastermindChat, agentId: string, displayNames: Record<string, string>): string {
  const name = displayNames[agentId] ?? agentId;
  const others = chat.roomIds
    .filter((id) => id !== agentId)
    .map((id) => displayNames[id] ?? id)
    .join(", ");
  const transcript = chat.turns
    .slice(-30)
    .map((t) => `${t.role === "user" ? "Idris" : (displayNames[t.agentId ?? ""] ?? t.agentId)}: ${t.error ? "(errored)" : t.text}`)
    .join("\n\n");
  return [
    `You are ${name}, one voice in Idris's MASTERMIND ROOM — a live group discussion between AI agents, each a different real model. Also in the room: ${others}.`,
    ``,
    `The conversation so far:`,
    `---`,
    transcript,
    `---`,
    ``,
    `Now it's your turn to speak. Rules:`,
    `- Answer Idris's latest message in your own voice.`,
    `- If other agents already replied this round, build on or push back against their specific points — name them (e.g. "Claude's second point misses…"). Never repeat what's already been said.`,
    `- Under 160 words. No meta-commentary about being an AI or a panel member. No greetings.`,
  ].join("\n");
}

/**
 * Fire the round: chosen responders reply in turn, each seeing earlier
 * replies. Returns immediately; clients poll.
 */
export async function postMessage(
  chatId: string,
  message: string,
  displayNames: Record<string, string>
): Promise<MastermindChat | null> {
  const chat = await getChat(chatId);
  if (!chat || chat.status === "running") return chat;

  chat.turns.push({ role: "user", text: message.slice(0, 4000), ts: Date.now() });
  if (chat.turns.filter((t) => t.role === "user").length === 1) {
    chat.title = message.slice(0, 60);
  }
  chat.turns = chat.turns.slice(-MAX_TURNS);
  chat.status = "running";
  chat.updatedAt = Date.now();
  live.set(chat.id, chat);
  await save(chat);

  const mentioned = parseMentions(message, chat.roomIds);
  const responders = mentioned.length > 0 ? mentioned : chat.roomIds;

  void (async () => {
    for (const agentId of responders) {
      chat.speaking = agentId;
      chat.updatedAt = Date.now();
      await save(chat);
      const r = await runAgentText(agentId, agentPrompt(chat, agentId, displayNames), { injectMemory: true });
      chat.turns.push({
        role: "agent",
        agentId,
        text: r.error ? "" : r.text,
        error: r.error,
        ts: Date.now(),
      });
      chat.updatedAt = Date.now();
      await save(chat);
    }
    chat.status = "idle";
    chat.speaking = undefined;
    chat.updatedAt = Date.now();
    await save(chat);
    live.delete(chat.id);
  })();

  return chat;
}
