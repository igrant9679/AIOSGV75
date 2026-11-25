import fs from "fs/promises";
import { productName } from "./netSettings";
import path from "path";
import os from "os";
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
      `# ${name}\n\n#agentic-os/agent\n\n${tagline ?? `AI agent on the ${productName()} deck.`}\n\nChats, missions, and memories from this agent link back here — open the backlinks pane or graph view to see everything ${name} has touched. Part of [[Agentic OS/Home|Agentic OS]].\n`,
      "utf8",
    );
  }
}

/**
 * Write only when the content differs. An identical rewrite still makes OneDrive
 * sync the file, and two machines doing that at the same moment is what leaves
 * "<name>-<PC>.md" conflict copies behind.
 */
async function writeIfChanged(file: string, content: string): Promise<void> {
  const current = await fs.readFile(file, "utf8").catch(() => null);
  if (current === content) return;
  await fs.writeFile(file, content, "utf8");
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
  // export the user guide so agents can answer questions about the OS via RAG
  try {
    const { guideMarkdown } = await import("./guideContent");
    const { productName } = await import("./netSettings"); // dynamic: netSettings imports this file
    await writeIfChanged(safeJoin("Guide.md"), guideMarkdown(productName()));
  } catch {
    /* non-fatal */
  }

  const home = [
    `# Agentic OS`,
    ``,
    `#agentic-os/home`,
    ``,
    `The control room of your AI operating system. Regenerated daily by ${productName()} — edits here get overwritten.`,
    ``,
    `## Live surfaces`,
    `- [[Agentic OS/Guide|User Guide]] — how the whole OS works`,
    `- [[Agentic OS/Rules|Agent Rules]] — the one note every agent follows; edit it to change how they behave`,
    `- [[Agentic OS/Memory|Shared Memory]] — what every agent knows`,
    `- [[Agentic OS/Goals|Goals]]`,
    `- [[Agentic OS/Tasks|Task Board]]`,
    `- [[Agentic OS/Journal/${today}|Today's journal]]`,
    `- [[Agentic OS/Chats/${today}|Today's chat log]]`,
    ``,
    `## Agents`,
    ...agentNames.map((id) => `- ${agentWikilink(id)}`),
    ``,
    `## Folders`,
    `- Missions/ — multi-agent run archives`,
    `- Workspaces/ — per-workspace goals & journals`,
    `- Weekly/ — one roll-up note per week`,
    `- Archive/ — mission logs and machine summaries older than 30 days (not searched by agents)`,
    ``,
  ].join("\n");
  await writeIfChanged(safeJoin("Home.md"), home);
  await ensureRulesNote().catch(() => false);
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
  // Tag the exchange heading with the machine it happened on, so the
  // Conversations search can organize by location across the shared vault.
  const host = os.hostname();
  const tagged = markdown.replace(/^(###\s.+)$/m, (m) => (m.includes("🖥") ? m : `${m} · 🖥 ${host}`));
  await fs.appendFile(file, `${header}\n${tagged.trimEnd()}\n`, "utf8");
  return file;
}

/** Path segments for a workspace ("Default" or empty → the vault base itself). */
function wsParts(workspace?: string): string[] {
  return workspace && workspace !== "Default" ? ["Workspaces", workspace] : [];
}

/* ---- agent rules ---- */

/** Only this much of the rules note is sent: it rides on EVERY agent call. */
export const RULES_MAX_CHARS = 2400;

/**
 * The rules every agent gets when Agentic OS/Rules.md is missing, and the body
 * the note is created with. No literal OS-verb tags in here on purpose: an
 * agent quoting its rules back in a chat reply would otherwise have the quoted
 * tag harvested and executed. The tag syntax itself is taught by VERB_HINT in
 * lib/retrieval.ts, which is code because the harvester parses it.
 */
export const DEFAULT_RULES = `## While working
- When you finish real work in a chat, log it in one line with the journal tag: what you did and what is still open.
- When a standing decision is made, save it with the remember tag, in one sentence. One fact per tag, and only facts that will still matter next month.
- Link every project, person or note you mention as a [[wikilink]].
- The memory and vault context you are given can be out of date. Prefer the newest note, and say so when you are unsure.

## Never
- Never put passwords, API keys or tokens in memory, the journal or goals.
- Never invent activity, meetings or deadlines that are not in the context you were given.
- Never use the tags in a scheduled brief or a mission report. They only work in chat replies.`;

function rulesNoteMarkdown(): string {
  return [
    `# Agent Rules`,
    ``,
    `#agentic-os/rules · [[Agentic OS/Home|Agentic OS]]`,
    ``,
    `> The one note every agent is given on every call, whichever agent it is and whichever machine it runs on.`,
    `> Edit it to change how they all behave. The change applies from the next message, with no restart.`,
    `> Keep it short: only the first ${RULES_MAX_CHARS.toLocaleString("en-US")} characters are sent. These quoted lines are not sent.`,
    ``,
    DEFAULT_RULES,
    ``,
  ].join("\n");
}

/** Create Agentic OS/Rules.md if it is missing. Never overwrites: the note is the user's. */
export async function ensureRulesNote(): Promise<boolean> {
  if (!(await vaultAvailable())) return false;
  await ensureDir(BASE);
  try {
    await fs.writeFile(safeJoin("Rules.md"), rulesNoteMarkdown(), { encoding: "utf8", flag: "wx" });
    return true;
  } catch {
    return false; // already there
  }
}

/** Drop frontmatter, the H1, the tag line and the quoted explainer: agents want the rules, not the note's scaffolding. */
function stripRulesChrome(note: string): string {
  return note
    .replace(/^\uFEFF/, "")
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#\s+[^\n]*\n?/, "")
    .replace(/^#agentic-os\/[^\n]*\n?/gm, "")
    .replace(/^>[^\n]*\n?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface AgentRules {
  text: string;
  /** "vault" = the user's note; "default" = built-in (note missing, empty, or vault offline). */
  source: "vault" | "default";
  truncated: boolean;
}

/**
 * The rules injected into every agent call. Read from the vault each time (no
 * cache), so an edit in Obsidian applies to the next message on every machine
 * as soon as OneDrive has delivered it.
 */
export async function readRules(): Promise<AgentRules> {
  let body = "";
  try {
    body = stripRulesChrome(await fs.readFile(safeJoin("Rules.md"), "utf8"));
  } catch {
    /* missing or vault offline */
  }
  if (!body) return { text: DEFAULT_RULES, source: "default", truncated: false };
  const truncated = body.length > RULES_MAX_CHARS;
  return { text: truncated ? body.slice(0, RULES_MAX_CHARS).trimEnd() : body, source: "vault", truncated };
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

/**
 * The maintained user profile — "who you are working with", distinct from
 * Memory.md's discrete facts. Memory.md is append-only and retrieved by
 * keyword (top-8 relevant); this is a single coherent note that is REWRITTEN
 * each refresh and injected whole into every agent. Keeping them apart stops
 * profile prose from crowding out the specific fact a query actually needed.
 */
export async function readUserProfile(): Promise<string> {
  try {
    return await fs.readFile(safeJoin("User Profile.md"), "utf8");
  } catch {
    return "";
  }
}

export async function writeUserProfile(content: string): Promise<void> {
  await ensureDir(BASE);
  await fs.writeFile(safeJoin("User Profile.md"), content, "utf8");
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
