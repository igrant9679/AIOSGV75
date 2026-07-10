import fs from "fs/promises";
import path from "path";
import { agentDisplayName, agentWikilink } from "./chatMarkdown";

/**
 * Obsidian vault bridge. Everything the app writes lives under
 * "<vault>/Agentic OS" — chats, goals, and journal entries as plain markdown
 * so they are first-class Obsidian notes. Override the vault root with
 * VAULT_DIR in .env.local.
 */
const VAULT_ROOT = process.env.VAULT_DIR ?? "C:\\Users\\Admin\\Documents\\IdrisGV75\\IdrisGV75";
const BASE = path.join(VAULT_ROOT, "Agentic OS");

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function vaultInfo() {
  return { root: VAULT_ROOT, base: BASE };
}

export async function vaultAvailable(): Promise<boolean> {
  try {
    await fs.access(VAULT_ROOT);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/** Resolve a file inside the Agentic OS folder, refusing path escapes. */
function safeJoin(...parts: string[]): string {
  const target = path.join(BASE, ...parts);
  const normalized = path.normalize(target);
  if (!normalized.startsWith(path.normalize(BASE))) {
    throw new Error("path escapes vault");
  }
  return normalized;
}

/* ---- knowledge graph scaffolding ---- */

/** Create an agent hub page if missing — the node all chats/missions/memories link to. */
export async function ensureAgentPage(agentId: string, tagline?: string): Promise<void> {
  const name = agentDisplayName(agentId);
  const dir = safeJoin("Agents");
  await ensureDir(dir);
  const file = path.join(dir, `${name}.md`);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(
      file,
      `# ${name}\n\n#agentic-os/agent\n\n${tagline ?? "AI agent on the Mission Control deck."}\n\nChats, missions, and memories from this agent link back here — open the backlinks pane or graph view to see everything ${name} has touched. Part of [[Agentic OS/Home|Agentic OS]].\n`,
      "utf8",
    );
  }
}

let scaffoldedFor = "";

/** (Re)build the Home MOC note once per day and make sure core hub pages exist. */
export async function ensureScaffold(agents: { id: string; tagline?: string }[] = []): Promise<void> {
  const today = todayStamp();
  if (scaffoldedFor === today) return;
  if (!(await vaultAvailable())) return;
  scaffoldedFor = today;

  await ensureAgentPage("claude", "Primary operator — Claude Code CLI bridge.");
  await ensureAgentPage("openclaw", "Personal assistant gateway (Telegram-connected).");
  await ensureAgentPage("hermes", "Nous Research agent.");
  for (const a of agents) await ensureAgentPage(a.id, a.tagline);

  const agentNames = ["claude", "openclaw", "hermes", ...agents.map((a) => a.id)];
  const home = [
    `# Agentic OS`,
    ``,
    `#agentic-os/home`,
    ``,
    `The control room of your AI operating system. Regenerated daily by Mission Control — edits here get overwritten.`,
    ``,
    `## Live surfaces`,
    `- [[Agentic OS/Memory|Shared Memory]] — what every agent knows`,
    `- [[Agentic OS/Goals|Goals]]`,
    `- [[Agentic OS/Journal/${today}|Today's journal]]`,
    `- [[Agentic OS/Chats/${today}|Today's chat log]]`,
    ``,
    `## Agents`,
    ...agentNames.map((id) => `- ${agentWikilink(id)}`),
    ``,
    `## Folders`,
    `- Missions/ — multi-agent run archives`,
    `- Workspaces/ — per-workspace goals & journals`,
    ``,
  ].join("\n");
  await fs.writeFile(safeJoin("Home.md"), home, "utf8");
}

export async function appendChatLog(agentId: string, markdown: string): Promise<string> {
  const dir = safeJoin("Chats");
  await ensureDir(dir);
  await ensureAgentPage(agentId);
  const file = path.join(dir, `${todayStamp()}.md`);
  let header = "";
  try {
    await fs.access(file);
  } catch {
    header = `# Chat Log — ${todayStamp()}\n\n#agentic-os/chat · [[Agentic OS/Home|Agentic OS]]\n`;
  }
  await fs.appendFile(file, `${header}\n${markdown.trimEnd()}\n`, "utf8");
  return file;
}

/** Path segments for a workspace ("Default" or empty → the vault base itself). */
function wsParts(workspace?: string): string[] {
  return workspace && workspace !== "Default" ? ["Workspaces", workspace] : [];
}

/* ---- shared memory ---- */

const MEMORY_HEADER = `# Shared Memory\n\n#agentic-os/memory\n\nFacts saved by your AI agents. Every agent reads this before answering and can append via <remember> tags.\n`;

export async function readMemory(): Promise<string> {
  try {
    return await fs.readFile(safeJoin("Memory.md"), "utf8");
  } catch {
    return "";
  }
}

export async function writeMemory(content: string): Promise<void> {
  await ensureDir(BASE);
  await fs.writeFile(safeJoin("Memory.md"), content, "utf8");
}

export async function appendMemory(entry: string, source: string): Promise<void> {
  await ensureDir(BASE);
  const file = safeJoin("Memory.md");
  let header = "";
  try {
    await fs.access(file);
  } catch {
    header = MEMORY_HEADER;
  }
  const d = new Date();
  const stamp = `${todayStamp()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  await ensureAgentPage(source).catch(() => {});
  const line = `- [${stamp} · ${agentWikilink(source)}] ${entry.replace(/\r?\n/g, " ").trim()}`;
  await fs.appendFile(file, `${header}${line}\n`, "utf8");
}

/** Digest of recently modified vault notes — fuel for the librarian mission. */
export async function recentNotesDigest(days = 7, maxChars = 9000): Promise<string> {
  const { collectVaultFiles } = await import("./vaultSearch");
  const files = await collectVaultFiles(VAULT_ROOT).catch(() => [] as string[]);
  const cutoff = Date.now() - days * 86_400_000;
  const recent: { file: string; mtime: number }[] = [];
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat && stat.mtimeMs >= cutoff) recent.push({ file, mtime: stat.mtimeMs });
  }
  recent.sort((a, b) => b.mtime - a.mtime);

  let out = "";
  for (const { file } of recent) {
    if (out.length >= maxChars) break;
    const rel = path.relative(VAULT_ROOT, file).replace(/\\/g, "/");
    const content = (await fs.readFile(file, "utf8").catch(() => "")).slice(0, 1200);
    out += `\n===== ${rel} =====\n${content.trim()}\n`;
  }
  return out.slice(0, maxChars) || "(no notes were modified in this period)";
}

/** Append a timestamped, agent-attributed entry to today's journal. */
export async function appendJournalEntry(entry: string, source: string, workspace?: string): Promise<void> {
  const date = todayStamp();
  const { content } = await readJournal(date, workspace);
  const d = new Date();
  const stamp = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  await ensureAgentPage(source).catch(() => {});
  const line = `**${stamp} · ${agentWikilink(source)}:** ${entry}`;
  await writeJournal(date, content ? `${content.replace(/\s+$/, "")}\n\n${line}\n` : `${line}\n`, workspace);
}

/* ---- mission logs ---- */

export async function writeMissionLog(mission: {
  title: string;
  prompt: string;
  strategy: string;
  results: { agentId: string; text: string; error?: string; ms: number }[];
  synthesis?: string;
}): Promise<string> {
  const dir = safeJoin("Missions");
  await ensureDir(dir);
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;
  const slug = mission.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "mission";
  const file = path.join(dir, `${todayStamp()} ${time} ${slug}.md`);

  const lines: string[] = [
    `# Mission: ${mission.title}`,
    ``,
    `#agentic-os/mission · strategy: **${mission.strategy}** · ${todayStamp()} ${time.replace("-", ":")} · [[Agentic OS/Home|Agentic OS]]`,
    ``,
    `## Task`,
    ``,
    mission.prompt,
    ``,
  ];
  for (const r of mission.results) {
    await ensureAgentPage(r.agentId).catch(() => {});
    lines.push(`## ${agentWikilink(r.agentId)} ${r.error ? "(error)" : `(${(r.ms / 1000).toFixed(1)}s)`}`, ``);
    lines.push(r.error ? `> ⚠️ ${r.error}` : r.text.trim() || "_no output_", ``);
  }
  if (mission.synthesis) {
    lines.push(`## ✦ Synthesis`, ``, mission.synthesis.trim(), ``);
  }
  await fs.writeFile(file, lines.join("\n"), "utf8");
  return file;
}

export interface GoalTask {
  text: string;
  done: boolean;
}

const TASK_RE = /^\s*-\s*\[( |x|X)\]\s*(.*)$/;

export async function readGoals(workspace?: string): Promise<GoalTask[]> {
  const file = safeJoin(...wsParts(workspace), "Goals.md");
  try {
    const raw = await fs.readFile(file, "utf8");
    const tasks: GoalTask[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(TASK_RE);
      if (m) tasks.push({ done: m[1].toLowerCase() === "x", text: m[2].trim() });
    }
    return tasks;
  } catch {
    return [];
  }
}

export async function writeGoals(tasks: GoalTask[], workspace?: string): Promise<void> {
  const file = safeJoin(...wsParts(workspace), "Goals.md");
  await ensureDir(path.dirname(file));

  // Preserve any non-task lines the user added in Obsidian; the checkbox
  // block itself is fully managed by the app.
  let preamble = `# Goals\n\n#agentic-os/goals\n`;
  try {
    const raw = await fs.readFile(file, "utf8");
    const kept = raw
      .split(/\r?\n/)
      .filter((line) => !TASK_RE.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
    if (kept) preamble = kept;
  } catch {
    /* first write */
  }

  const body = tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.text.replace(/\r?\n/g, " ")}`).join("\n");
  await fs.writeFile(file, `${preamble}\n\n${body}\n`, "utf8");
}

export async function readJournal(date: string, workspace?: string): Promise<{ content: string; dates: string[] }> {
  if (!DATE_RE.test(date)) throw new Error("bad date");
  const dir = safeJoin(...wsParts(workspace), "Journal");
  await ensureDir(dir);

  let content = "";
  try {
    content = await fs.readFile(path.join(dir, `${date}.md`), "utf8");
  } catch {
    /* no entry yet */
  }

  const files = await fs.readdir(dir);
  const dates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .map((f) => f.replace(/\.md$/, ""))
    .sort()
    .reverse();

  return { content, dates };
}

export async function writeJournal(date: string, content: string, workspace?: string): Promise<void> {
  if (!DATE_RE.test(date)) throw new Error("bad date");
  const dir = safeJoin(...wsParts(workspace), "Journal");
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, `${date}.md`), content, "utf8");
}
