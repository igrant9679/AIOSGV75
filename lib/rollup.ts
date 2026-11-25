import fsp from "fs/promises";
import path from "path";
import { productName } from "./netSettings";
import { vaultAvailable, vaultInfo } from "./vault";
import { sweepGeneratedCopies } from "./conflictCopies";

/**
 * Weekly roll-up and archive — what keeps the vault lean as it grows.
 *
 *  1. ROLL-UP. For every finished week (Mon–Sun) that has material and no note
 *     yet, write Agentic OS/Weekly/<YYYY>-W<ww>.md: the Vault Librarian's
 *     synthesis if one ran that week, the facts saved to shared memory, the
 *     journal, one line per mission, the machine summaries and a chat count.
 *     Built from the files themselves — no agent call — so it cannot fail on a
 *     signed-out CLI, and writing a week twice gives the same note.
 *
 *  2. ARCHIVE. Mission logs and daily machine summaries older than
 *     ARCHIVE_AFTER_DAYS move to Agentic OS/Archive/<folder>/<YYYY-MM>/, and
 *     ONLY once the roll-up note for their week exists: nothing leaves the
 *     searchable vault before its summary is in it. The search index skips
 *     Archive (lib/vaultSearch.ts); Obsidian and the Library still show it.
 *
 * Not moved, deliberately: Journal and Chats (the Journal and Conversations
 * pages read them in place, and they are tiny), and Sessions (the Projects page
 * finds digests by folder, and a moved digest would simply be written again).
 * Sessions are bounded by the search index's per-folder budget instead.
 *
 * Runs on the master every few hours (scheduler.ts). Safe to repeat and safe
 * if two masters overlap: notes are created with an exclusive open, and a file
 * that is already in Archive is left alone.
 */

const DAY = 86_400_000;
export const ARCHIVE_AFTER_DAYS = 30;
const ARCHIVED_FOLDERS = ["Missions", "Daily Summaries"] as const;
const MAX_MOVES_PER_RUN = 2000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday 00:00 (local) of the week containing `d`. */
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** ISO-8601 week label, e.g. "2026-W47". The week's Thursday decides the year. */
export function weekKey(monday: Date): string {
  const thursday = addDays(monday, 3);
  const firstMonday = mondayOf(new Date(thursday.getFullYear(), 0, 4));
  // round(): a DST change makes one week 167 or 169 hours long
  const week = Math.round((mondayOf(thursday).getTime() - firstMonday.getTime()) / (7 * DAY)) + 1;
  return `${thursday.getFullYear()}-W${pad(week)}`;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}\n…(shortened)` : s);

// ─── reading the week's material ───

interface Dated {
  name: string;
  file: string;
  date: string;
  archived: boolean;
}

/** Notes named "<YYYY-MM-DD>….md" in a folder, plus the ones already moved to Archive. */
async function listDated(folder: string): Promise<Dated[]> {
  const base = vaultInfo().base;
  const out: Dated[] = [];
  const take = async (dir: string, archived: boolean) => {
    for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})(?: .*)?\.md$/);
      if (m) out.push({ name, file: path.join(dir, name), date: m[1], archived });
    }
  };
  await take(path.join(base, folder), false);
  const arch = path.join(base, "Archive", folder);
  for (const month of await fsp.readdir(arch).catch(() => [] as string[])) await take(path.join(arch, month), true);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

interface MissionLine {
  name: string; // file name without .md — a link that still resolves after the move to Archive
  date: string;
  time: string;
  title: string;
  agents: string[];
  failed: boolean;
  error?: string;
  /** the last agent's output (or the synthesis) — only kept for the librarian */
  output: string;
}

const AGENT_HEADING = /^## \[\[Agentic OS\/Agents\/[^\]|]+\|([^\]]+)\]\] \((error|[\d.]+s)\)[ \t]*$/gm;

function parseMission(d: Dated, md: string): MissionLine {
  const base = d.name.replace(/\.md$/, "");
  const time = (base.match(/^\d{4}-\d{2}-\d{2} (\d{2})-(\d{2})/) ?? []).slice(1, 3).join(":");
  const first = md.split(/\r?\n/, 1)[0] ?? "";
  let title = first.replace(/^#\s*/, "").replace(/^Mission:\s*/, "").replace(/^⏰\s*/, "").trim() || base;
  if (title.length > 90) title = `${title.slice(0, 90)}…`;

  // An orchestration log carries its status on the tag line instead of per-agent headings.
  const orch = md.match(/^#agentic-os\/mission · \[\[[^\]]+\]\] · (\w+) · \d+ subtasks/m);
  if (orch) return { name: base, date: d.date, time, title, agents: [], failed: orch[1] !== "done", output: "" };

  let heads = [...md.matchAll(AGENT_HEADING)];
  // A scheduled brief's prompt embeds a digest of other notes, which can contain
  // older missions' headings. A single-agent run has exactly one real one: the last.
  if (/strategy: \*\*single\*\*/.test(md) && heads.length > 1) heads = heads.slice(-1);
  const agents = [...new Set(heads.map((h) => h[1]))];
  const failed = heads.length > 0 && heads.every((h) => h[2] === "error");

  const synth = md.lastIndexOf("\n## ✦ Synthesis");
  const last = heads[heads.length - 1];
  const from = synth >= 0 ? synth + "\n## ✦ Synthesis".length : last ? (last.index ?? 0) + last[0].length : -1;
  const output = from >= 0 ? md.slice(from).trim() : "";
  const error = failed ? output.match(/^> ⚠️ (.+)$/m)?.[1]?.replace(/\s+/g, " ").slice(0, 120) : undefined;
  return { name: base, date: d.date, time, title, agents, failed, error, output };
}

interface Week {
  monday: Date;
  memory: string[];
  journal: { date: string; where: string; text: string }[];
  missions: MissionLine[];
  machines: { date: string; text: string }[];
  chats: { date: string; exchanges: number; agents: Map<string, number> }[];
}

async function gatherWeeks(): Promise<Map<string, Week>> {
  const base = vaultInfo().base;
  const weeks = new Map<string, Week>();
  const weekFor = (date: string): Week => {
    const monday = mondayOf(parseYmd(date));
    const key = ymd(monday);
    if (!weeks.has(key)) weeks.set(key, { monday, memory: [], journal: [], missions: [], machines: [], chats: [] });
    return weeks.get(key)!;
  };
  const read = (file: string) => fsp.readFile(file, "utf8").catch(() => "");

  for (const line of (await read(path.join(base, "Memory.md"))).split(/\r?\n/)) {
    const m = line.match(/^- \[(\d{4}-\d{2}-\d{2})/);
    if (m) weekFor(m[1]).memory.push(line.trim());
  }

  const journals: [string, string][] = [["", path.join(base, "Journal")]];
  for (const ws of await fsp.readdir(path.join(base, "Workspaces")).catch(() => [] as string[])) {
    journals.push([ws, path.join(base, "Workspaces", ws, "Journal")]);
  }
  for (const [where, dir] of journals) {
    for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
      const m = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!m) continue;
      const text = (await read(path.join(dir, name))).trim();
      if (text) weekFor(m[1]).journal.push({ date: m[1], where, text: clip(text, 1500) });
    }
  }

  for (const d of await listDated("Missions")) {
    const md = await read(d.file);
    if (md) weekFor(d.date).missions.push(parseMission(d, md));
  }

  for (const d of await listDated("Daily Summaries")) {
    if (!/^\d{4}-\d{2}-\d{2} Machines\.md$/.test(d.name)) continue;
    const body = (await read(d.file))
      .replace(/^\uFEFF?---[\s\S]*?\n---\s*/, "")
      .replace(/^#\s[^\n]*\n?/, "")
      .replace(/^Written by [^\n]*\n?/m, "")
      .trim();
    if (body) weekFor(d.date).machines.push({ date: d.date, text: clip(body, 1200) });
  }

  for (const name of await fsp.readdir(path.join(base, "Chats")).catch(() => [] as string[])) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue;
    const agents = new Map<string, number>();
    let exchanges = 0;
    for (const h of (await read(path.join(base, "Chats", name))).matchAll(/^###\s+\d{1,2}:\d{2}:\d{2}\s+·\s+(.+)$/gm)) {
      exchanges++;
      const who = (h[1].match(/\[\[[^\]|]*\|([^\]]+)\]\]/)?.[1] ?? h[1].split("·")[0]).trim();
      agents.set(who, (agents.get(who) ?? 0) + 1);
    }
    if (exchanges > 0) weekFor(m[1]).chats.push({ date: m[1], exchanges, agents });
  }

  for (const w of weeks.values()) {
    w.journal.sort((a, b) => a.date.localeCompare(b.date));
    w.machines.sort((a, b) => a.date.localeCompare(b.date));
    w.chats.sort((a, b) => a.date.localeCompare(b.date));
  }
  return weeks;
}

// ─── the note ───

function weekNote(w: Week): string {
  const sunday = addDays(w.monday, 6);
  const key = weekKey(w.monday);
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const failed = w.missions.filter((m) => m.failed).length;
  const exchanges = w.chats.reduce((n, c) => n + c.exchanges, 0);
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const out: string[] = [
    `---`,
    `type: weekly-rollup`,
    `week: ${key}`,
    `from: ${ymd(w.monday)}`,
    `to: ${ymd(sunday)}`,
    `---`,
    ``,
    `# Week ${Number(key.slice(-2))} · ${day(w.monday)} to ${day(sunday)} ${sunday.getFullYear()}`,
    ``,
    `#agentic-os/weekly · [[Agentic OS/Home|Agentic OS]]`,
    ``,
    `> Written by ${productName()}. One note for the whole week, built from the journal, shared memory, mission logs, machine summaries and chat logs. Mission logs and machine summaries older than ${ARCHIVE_AFTER_DAYS} days move to Agentic OS/Archive once this note exists; agents search this note instead of them.`,
    ``,
    `## At a glance`,
    ``,
    `- ${
      [
        w.missions.length > 0 && `${count(w.missions.length, "mission")}${failed ? ` (${failed} failed)` : ""}`,
        w.journal.length > 0 && count(w.journal.length, "journal day"),
        w.memory.length > 0 && `${count(w.memory.length, "fact")} saved to memory`,
        exchanges > 0 && count(exchanges, "chat exchange"),
        w.machines.length > 0 && count(w.machines.length, "machine summary", "machine summaries"),
      ]
        .filter(Boolean)
        .join(" · ") || "a quiet week"
    }`,
    ``,
  ];

  const librarian = [...w.missions].reverse().find((m) => !m.failed && m.output && /librarian|weekly synthesis/i.test(`${m.name} ${m.title}`));
  if (librarian) {
    // the synthesis is a note of its own (it opens with an H1): nest it under this section
    // Mission output is never harvested, so a tag the librarian wrote is still literal
    // here. Left in, an agent that later quotes this note in a chat reply would have
    // the tag executed. Keep the words, drop the tag.
    const body = clip(librarian.output, 4000)
      .replace(/<(remember|goal|journal|mission)>([\s\S]*?)<\/\1>/g, "$2")
      .replace(/^(#{1,4}) /gm, "##$1 ");
    out.push(`## Synthesis`, ``, `From [[${librarian.name}]].`, ``, body, ``);
  }

  if (w.memory.length > 0) out.push(`## Decisions and facts saved`, ``, ...w.memory, ``);

  if (w.journal.length > 0) {
    out.push(`## Journal`, ``);
    for (const j of w.journal) out.push(`### ${j.date}${j.where ? ` · ${j.where}` : ""}`, ``, j.text, ``);
  }

  if (w.missions.length > 0) {
    out.push(`## Missions`, ``);
    for (const m of w.missions) {
      const who = m.agents.length > 0 ? ` · ${m.agents.join(", ")}` : "";
      const state = m.failed ? ` · **failed**${m.error ? `: ${m.error}` : ""}` : "";
      out.push(`- ${m.date} ${m.time} · ${m.title}${who}${state} · [[${m.name}]]`);
    }
    out.push(``);
  }

  if (w.machines.length > 0) {
    out.push(`## Machines`, ``);
    for (const m of w.machines) out.push(`### ${m.date}`, ``, m.text.replace(/^(#{1,3}) /gm, "##$1 "), ``);
  }

  if (w.chats.length > 0) {
    out.push(`## Chats`, ``);
    for (const c of w.chats) {
      const who = [...c.agents.entries()].map(([a, n]) => `${a} ${n}`).join(", ");
      out.push(`- ${c.date}: ${count(c.exchanges, "exchange")} (${who}) · [[Agentic OS/Chats/${c.date}|log]]`);
    }
    out.push(``);
  }
  return out.join("\n");
}

const ARCHIVE_ABOUT = (name: string) =>
  [
    `# About this folder`,
    ``,
    `#agentic-os/archive · [[Agentic OS/Home|Agentic OS]]`,
    ``,
    `${name} moves mission logs and daily machine summaries here once they are older than ${ARCHIVE_AFTER_DAYS} days, and only after the roll-up note for their week has been written to Agentic OS/Weekly.`,
    ``,
    `- Nothing is deleted. Every note is still here, readable in Obsidian and in the Library.`,
    `- Agents do not search this folder. They search the weekly notes, which link back to these by name.`,
    `- A note moved back to its old folder is archived again on the next pass. To keep something in front of the agents, copy what matters into a live note.`,
    ``,
  ].join("\n");

// ─── running it ───

export interface RollupResult {
  dryRun: boolean;
  /** stale OneDrive conflict copies removed first, so they are not rolled up as real notes */
  swept: number;
  weeksWritten: string[];
  /** notes moved to Archive, per folder */
  archived: Record<string, number>;
  /** already present in Archive under the same name — left where they were */
  skipped: number;
}

let running = false;

export async function runRollup(opts: { dryRun?: boolean } = {}): Promise<RollupResult> {
  const dryRun = !!opts.dryRun;
  const result: RollupResult = { dryRun, swept: 0, weeksWritten: [], archived: {}, skipped: 0 };
  if (running || !(await vaultAvailable())) return result;
  running = true;
  try {
    const base = vaultInfo().base;
    const now = new Date();
    result.swept = await sweepGeneratedCopies({ dryRun });

    // 1. roll-up notes for finished weeks that don't have one
    const weeklyDir = path.join(base, "Weekly");
    const have = new Set(
      (await fsp.readdir(weeklyDir).catch(() => [] as string[])).map((n) => n.match(/^(\d{4}-W\d{2})\.md$/)?.[1]).filter((k): k is string => !!k),
    );
    const weeks = [...(await gatherWeeks()).values()].sort((a, b) => a.monday.getTime() - b.monday.getTime());
    for (const w of weeks) {
      if (addDays(w.monday, 7).getTime() > now.getTime()) continue; // week still running
      const key = weekKey(w.monday);
      if (have.has(key)) continue;
      if (!dryRun) {
        await fsp.mkdir(weeklyDir, { recursive: true });
        try {
          await fsp.writeFile(path.join(weeklyDir, `${key}.md`), weekNote(w), { encoding: "utf8", flag: "wx" });
        } catch {
          continue; // another master wrote it between the listing and now
        }
      }
      have.add(key);
      result.weeksWritten.push(key);
    }

    // 2. archive what is old AND rolled up
    const cutoff = now.getTime() - ARCHIVE_AFTER_DAYS * DAY;
    let moves = 0;
    for (const folder of ARCHIVED_FOLDERS) {
      for (const d of await listDated(folder)) {
        if (d.archived || moves >= MAX_MOVES_PER_RUN) continue;
        const date = parseYmd(d.date);
        if (Number.isNaN(date.getTime()) || date.getTime() >= cutoff) continue;
        if (!have.has(weekKey(mondayOf(date)))) continue;
        const destDir = path.join(base, "Archive", folder, d.date.slice(0, 7));
        const dest = path.join(destDir, d.name);
        if (await fsp.stat(dest).then(() => true, () => false)) {
          result.skipped++;
          continue;
        }
        if (!dryRun) {
          await fsp.mkdir(destDir, { recursive: true });
          try {
            await fsp.rename(d.file, dest);
          } catch {
            continue; // locked or mid-sync — next pass
          }
        }
        moves++;
        result.archived[folder] = (result.archived[folder] ?? 0) + 1;
      }
    }
    if (!dryRun && moves > 0) {
      await fsp
        .writeFile(path.join(base, "Archive", "About this folder.md"), ARCHIVE_ABOUT(productName()), { encoding: "utf8", flag: "wx" })
        .catch(() => {});
    }
    if (!dryRun && (result.weeksWritten.length > 0 || moves > 0 || result.swept > 0)) {
      console.log(
        `[mission-control] roll-up: ${result.weeksWritten.length} weekly note(s), ${moves} note(s) archived, ${result.swept} conflict cop${result.swept === 1 ? "y" : "ies"} removed`,
      );
    }
    return result;
  } finally {
    running = false;
  }
}

let lastCheck = 0;

/** Master tick. Cheap when there is nothing to do; looks every few hours, so Monday's note appears by mid-morning. */
export async function maybeWeeklyRollup(): Promise<void> {
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  await runRollup();
}
