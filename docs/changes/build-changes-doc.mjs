#!/usr/bin/env node
/**
 * Builds docs/Mission-Control-Changes.docx: what changed in Mission Control over the last week, and
 * what is waiting on the owner. KEEP IT UPDATED: when the owner asks for a change to the app, add it
 * to SECTIONS (or WAITING), add a line to HISTORY, bump META.updated, run this, and commit both files.
 *
 *   node docs/changes/build-changes-doc.mjs        (needs the "docx" package: npm install -g docx)
 *
 * The appendix (every commit in the period) is read from git at build time.
 * The repository is PUBLIC: no emails, keys, tokens or account ids in here.
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const require = createRequire(import.meta.url);
let docx;
let docxRequire = require;
try {
  docx = require("docx");
} catch {
  const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  docxRequire = createRequire(path.join(globalRoot, "docx", "package.json"));
  docx = docxRequire("docx");
}
const JSZip = docxRequire("jszip");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, LevelFormat, BorderStyle, Footer, Header, PageNumber, TabStopType } = docx;

// ─────────────────────────────── CONTENT ───────────────────────────────

const META = {
  title: "Mission Control: what changed this week",
  period: "24–27 November 2026",
  since: "2026-11-20", // git log --since (the last 7 days when first written)
  updated: "27 November 2026",
  version: "1.9",
};

const SUMMARY = [
  "Mission Control had its busiest week yet: 30 updates in four days (24–27 November). The work falls into five themes: running and watching **all your machines from one place**, **project runs** that plan, delegate, check and review real work, **more AI tools on your subscriptions** (Hermes, Gemini CLI and other ACP agents, local models), **reliability** after two crashes on Raider18, and **easier setup** through the Help panel and both installers.",
  "Raider18 runs every change below. The other five machines are still on an older version and need one manual update before most of the cross-machine features work there (see **Waiting on you**).",
];

// Each section: a title, an optional intro, and items { name, what, date }. "what" may use **bold**.
const SECTIONS = [
  {
    title: "Your machines, managed from one place",
    intro: "Fleet now shows and controls every computer in the group, not just this one.",
    items: [
      { name: "Update every machine (Fleet → Versions)", date: "26 Nov", what: "Shows which build each machine runs and how far it is behind GitHub. **Update** or **Update all** pulls, builds and restarts Mission Control there, after waiting until nothing is running. A failed build rolls back and the old version keeps serving." },
      { name: "Load per machine", date: "26 Nov", what: "CPU, memory (the Windows commit charge, which is what predicts a crash) and GPU for every machine, every minute. A machine with memory nearly full is given no new work from other machines." },
      { name: "Fleet pause", date: "26 Nov", what: "One switch holds all automatic work on every machine (schedules, watchers, project runs, hand-offs) for 1 hour, 4 hours or until resumed. Work you start by hand still runs." },
      { name: "Setup view (Fleet → Setup)", date: "26 Nov", what: "Every machine's MCP servers, plugins, skills, CLI versions and Ollama models side by side. Turn an MCP server or plugin off or on per machine, and **copy a skill** to a machine that lacks it (checked on arrival; the receiving machine must allow file edits)." },
      { name: "Usage per account (Fleet → Accounts)", date: "26 Nov", what: "One row per Claude or ChatGPT login, adding up every machine that uses it. When one machine hits a login's limit, work stops going to every machine on that login until it resets." },
      { name: "Remote actions log", date: "26 Nov", what: "Every request one machine makes of another (replies, stops, moves, updates, setup changes, skill copies) is recorded on both ends. A request that names a sender with no record of sending it is flagged: the sign of something writing fake requests into the shared vault." },
    ],
  },
  {
    title: "Project runs: real work, planned and checked",
    intro: "Describe a goal; Mission Control plans it into tasks, gives each to the cheapest suitable worker, checks and reviews the work, and delivers.",
    items: [
      { name: "Plan, delegate, review (phase 1)", date: "24 Nov", what: "A brief becomes tasks with tiers and dependencies. The plan waits for your approval, then each task is done by a real session: Hermes on a free model for routine work, Codex for standard, Claude for hard. Work is reviewed from a tier above, sent back with the reviewer's words, and moved up a tier after two rejections." },
      { name: "Checks the machine runs itself (phase 2)", date: "24 Nov", what: "A project lists the commands it trusts as proof (tests, a build, a type check). Mission Control runs them after the worker finishes, and only passing work goes to review. The list is per machine and can't be changed from anywhere else." },
      { name: "Local model as a worker", date: "25 Nov", what: "The smallest text-only tasks go first to a local model (Ollama) for free; it gets no tools and can't write to shared memory. If its answer is rejected, the task goes to the normal workers without losing an attempt." },
      { name: "Spread, learn, and branch (phases 3–5)", date: "25 Nov", what: "Answer-only tasks can run on a less busy machine; one that doesn't pick a task up in time is skipped. Every run leaves lessons that the next plan for that project reads. In a clean git repository each run works on its own branch, one commit per accepted task, and reviewers see the real diff." },
      { name: "Runs outlast one sitting", date: "26 Nov", what: "A long Claude task stopped for time carries on in the same session instead of starting over. Run work starts without your MCP servers (two WanGP servers used about 8 GB per run and crashed Raider18), and processes left behind by a crash are stopped on the next start." },
      { name: "Another machine's local model", date: "27 Nov", what: "When the machine running a run has no local model it can use, a routine text task can go to another machine's (for example inkling-2-mini on a stronger PC). Each machine shares which model it lends and whether it can load it right now; LAN machines with the most free memory are preferred." },
    ],
  },
  {
    title: "More AI tools, all on your subscriptions",
    intro: "Mission Control uses your Claude, ChatGPT, Gemini and Kimi plans, never pay-per-token API keys.",
    items: [
      { name: "Auto on subscriptions only", date: "24 Nov", what: "Auto no longer reaches for a pay-per-token model on its own; a model with an API key is used only if you opt it in. Auto gained Hermes (free model) and Codex (ChatGPT plan) as workers." },
      { name: "Hermes sessions", date: "24 Nov", what: "Hermes joined Claude Code and Codex: its sessions can be listed, read, replied to and started from any machine. What it may do is set by the toolsets it is given, because it can't stop to ask." },
      { name: "ACP agents: Gemini CLI, Kimi CLI and others", date: "26 Nov", what: "Agents that speak the Agent Client Protocol are now session tools (Fleet → Agents & fallback): New session, Run somewhere, Team and the fallback can use them. Mission Control answers their permission requests for you (reading allowed; editing only with “Can edit files”; commands and deletions always refused) and never signs an agent in. Verified with Gemini CLI." },
      { name: "When a plan hits its limit", date: "26 Nov", what: "A reply or new session that fails because its plan is at its limit carries on with the next ready tool (default Claude Code → Codex → local model), in the same folder, with the conversation so far. You set the order per machine." },
      { name: "Send when free", date: "26 Nov", what: "Tick “when it's free” under a reply: the message waits until the session is closed, earlier messages to it have finished, and its plan isn't at its limit, then continues the session itself. Gives up after 24 hours; can be cancelled." },
      { name: "Team (Command → Team)", date: "26 Nov", what: "Named teammates, each with a role, a tool, a machine and a folder, each in its own session. Write “@Ada fix the test”; a teammate whose reply ends with “@Linus: review it” hands work on. Chains stop after 6 hand-offs without you and wait while the fleet is paused. A teammate whose plan hits its limit keeps its role on the next tool." },
    ],
  },
  {
    title: "Reliability and safety",
    items: [
      { name: "Vault search could see the whole vault again", date: "24 Nov", what: "Search had silently stopped indexing most folders (Missions, Journal, Chats, Agents) because one cap filled up inside the session notes. Each folder now has its own budget, newest first." },
      { name: "Agent rules in one note", date: "24 Nov", what: "Agentic OS/Rules.md is given to every agent on every call: changing how all agents behave is an edit to one note, with no rebuild." },
      { name: "Weekly roll-up and archive", date: "24 Nov", what: "A weekly note per finished week (memory, journal, missions, machines), and logs older than 30 days move to Archive once their week is summarised." },
      { name: "Local models load only where they fit", date: "27 Nov", what: "On Windows a local model takes about 1.4 times its size in memory even when it runs on the graphics card (gpt-oss:20b took Raider18 from 69% to 94%). Every place that loads one now checks first that memory will stay under 93%." },
      { name: "Is the Telegram gateway really working?", date: "27 Nov", what: "Each machine's health check now asks its OpenClaw gateway which chat channels are connected, and shares the answer: the primary shows whether Talos is running and connected to Telegram (or why not), and any other machine with a Telegram gateway is flagged, since two machines polling one bot take each other's messages. Raider18's own gateway has no Telegram channel, so it doesn't compete with Legion7." },
      { name: "Silent server crashes investigated", date: "27 Nov", what: "Raider18's server had died six times (code 0xC0000409) with nothing logged. Cause still unknown, but: Node.js updated 24.15 → 24.22.3 on Raider18, the server now starts without npm (whose exit could take it down), and Microsoft ProcDump is attached so the next crash leaves a dump. The server has run cleanly since." },
    ],
  },
  {
    title: "GitHub dashboard",
    intro: "One page for every repository on both GitHub accounts (igrant9679 and sgrant5724).",
    items: [
      { name: "LevelUp → the fleet: plan there, approve, the fleet does it (Work → LevelUp)", date: "27 Nov", what: "Hand tasks and projects to the fleet from LevelUp, your planning app, as you plan your day, week or month. Every hand-off has an area: a client (LSI Media, CommunityForce, MeYouSocial) or Personal with the goal it serves. Mission Control checks LevelUp every minute (it never accepts connections), proposes which machine and tool does it and where, and starts it only after you approve, in LevelUp or in Work, on the day you chose. The result comes back to LevelUp to accept or send back. LevelUp's Fleet panel also lists what is waiting on you in Mission Control. Areas: a work folder per area and an area per repository; with no folder chosen a hand-off is answered in writing only. LevelUp's part is built on a branch and not live yet (it goes live to LevelUp's customers when merged, though only you see the Fleet). Tested end to end with a local copy of LevelUp: hand off, propose, cancel, approve, a real run on Raider18, result, accept." },
      { name: "Work: every repository task, assigned to you or the fleet (sidebar → Work)", date: "27 Nov", what: "All the to-dos, next steps, action items and “waiting on you” lines in your repositories' documents, open issues and GitHub's own signals, on one board (Inbox → To do → In progress → Review → Done) or **by project**. Assign each to yourself, a Team teammate, or a machine and tool that has the project's folder, or let Mission Control do it (**Assign for me**; **Smart assign** asks Claude about unclear ones). **Start** hands a task to its AI with its context and follows it to Review with the result. First sync: 153 tasks across 8 projects (42 yours, 32 for the fleet, 79 in projects no machine has). Before a task starts, its folder on this PC is brought up to date with GitHub when nothing local can be lost (Raider18's usip folder was 636 commits behind). Verified with a real task: Claude Code found a usip to-do item already done in today's code (fixed 20 September)." },
      { name: "GitHub page (sidebar → GitHub)", date: "27 Nov", what: "Covers all 23 repositories (12 private, 11 public) with a written report for every one, active or quiet. For the last 7, 14 or 30 days: every repository's commits, pull requests, issues, releases, checks and security alerts, each project's own status documents (“this week”, changes, status, handoff), and your GitHub activity. Claude writes a short report per active repository and an overview with your priorities, with every tool switched off so nothing in a repository can make it act. **Waiting on you** gathers reviews, failing checks, assigned issues, replies owed and the documents' “waiting on you” items in one list. Refreshes daily; private details stay on the computer." },
    ],
  },
  {
    title: "Help, networking and installers",
    items: [
      { name: "Appearance: push a look to the whole Fleet", date: "27 Nov", what: "Appearance → The whole Fleet → Push this look to the whole Fleet: every machine's Mission Control switches to this browser's whole look (presets, theme, custom colours, fonts, background picture, menu) within a few minutes, once; after that each can change again until the next push. A browser can keep its own look instead, and Stop sharing leaves every machine as it is. Machines need this version first (Fleet → Versions → Update all)." },
      { name: "Appearance: customize everything (sidebar → Appearance)", date: "27 Nov", what: "Beyond the presets: any colour for every accent, background, panel, border and text tone (dark and light separately); any font installed on the computer for the interface, headings and code; zoom 70–160%, corner roundness, panel opacity and menu width; a background colour, gradient or your own picture (dimmed and blurred if you like); the menu renamed, reordered and trimmed, groups included, and placed on the left, the right or across the top. Saved looks keep several, and Export / Import copy one to another machine. Applied before the page draws, so there's no flash; every value is checked so nothing unexpected can get into the page's styles." },
      { name: "Help on every page", date: "25 Nov", what: "A Help button (or F1) opens a panel: what this page is for, step-by-step instructions, a “which page do I use?” guide, ~30 searchable how-tos, a glossary, and Ask (answers from the manual)." },
      { name: "Proof that OneDrive works", date: "25 Nov", what: "Fleet → Network shows when each machine was last heard from through OneDrive, and “Test OneDrive” measures a real round trip." },
      { name: "Installers: a better local chat model", date: "24 Nov", what: "gpt-oss:20b replaces llama3.2 (which failed simple tasks), offered according to the machine's graphics card, and the installer adds it to Mission Control automatically." },
      { name: "Installers: the routine-work model", date: "27 Nov", what: "Windows and Mac installers offer inkling-2-mini (18 GB) as the model for routine work, lent to the other machines' runs. Pre-ticked only on big machines (Windows: 24 GB+ GPU and 96 GB+ RAM; Mac: Apple Silicon with 64 GB+)." },
    ],
  },
];

const FINDINGS = [
  "**Raider18 uses a different Claude login** (a Team plan) from the other machines that report one (Max plan). Worth confirming that's intended.",
  "**Idris-2-16gb** used far more Claude tokens than any other machine in the week the Accounts panel first measured (about 48 million in 7 days).",
  "**Gemini CLI on Raider18 was installed from inside the Claude app**, so only that app can see it (the app's private folder). Mission Control finds it anyway, but reinstalling it from a normal PowerShell is cleaner. Same for two other tools installed that way.",
  "**inkling-2-mini can't load on Raider18** at its usual load: it needs about 31 GB free, the PC usually has about 20 GB. Machines with more memory are the right home for it.",
  "**An OpenClaw gateway runs on Raider18** (its own scheduled task). Only one machine should poll the Telegram bot (Legion7).",
  "**OpenBot (openbot.run) was reviewed and not adopted**: its licence is non-commercial only, its agents act without asking, and it would use the same logins without Accounts seeing them. Four of its ideas were built natively instead (fallback, send when free, ACP agents, Team).",
];

// What the owner needs to do or decide. status: "to do" | "decision" | "optional" | "done"
const WAITING = [
  { item: "Update the machines for the fleet look", status: "to do", why: "Pushing a look to the whole Fleet, and the LevelUp hand-offs, need the latest version on each machine.", how: "Fleet → Versions → Update all (each waits until it is idle)." },
  { item: "LevelUp's Fleet: OK it going live", status: "done", why: "LevelUp's part is on the branch fleet-integration. Merging it to main deploys it to levelupnow.tools, where only you (the owner of your workspace) will see the Fleet.", how: "Say go and it will be merged (after LevelUp's full checks), or look at the branch first." },
  { item: "Connect Mission Control to LevelUp", status: "to do", why: "Once LevelUp's part is live.", how: "LevelUp → Fleet → Make a key for Mission Control; then Mission Control → Work → LevelUp → paste the address and key → Connect (on Raider18, where Work lives)." },
  { item: "Set areas", status: "optional", why: "Hand-offs that name no repository need a work folder for their area to change files; repositories need an area for the area filter and for LevelUp's list.", how: "Work → LevelUp → Areas: a work folder for LSI Media, CommunityForce, MeYouSocial and Personal, and an area per repository."  },
  { item: "Add igrant9679 back to Git Credential Manager", status: "done", why: "After the two GitHub sign-ins, git on Raider18 only has sgrant5724 saved, so pushes to igrant9679's repositories from any other folder or Claude session are refused (Mission Control's own repository was given a local fix).", how: "In a normal PowerShell window: git credential-manager github login, and sign in as igrant9679." },
  { item: "Look at Work and start some tasks", status: "optional", why: "153 tasks came in from your repositories; 32 are assigned to the fleet and ready to start, 42 are yours.", how: "Sidebar → Work: check the assignments, then Start (or Start all assigned)." },
  { item: "Sign the GitHub CLI in to both accounts", status: "done", why: "The GitHub page can only see public repositories (11) until the GitHub CLI is signed in to igrant9679 and sgrant5724.", how: "In a normal PowerShell window (not inside the Claude app): gh auth login --hostname github.com --git-protocol https --web, approve in the browser; run it again as the other account. Then GitHub → Refresh." },
  { item: "Update the other five machines", status: "done", why: "They run an older version: Accounts, Remote actions checks, send-when-free, Team, ACP agents and the crash fix only work across machines once they're current.", how: "On each machine run update.cmd in its Mission Control folder once (Idris-2-16gb when it's next on). After that: Fleet → Versions → Update all." },
  { item: "Gemini CLI: reinstall and sign in", status: "to do", why: "It is installed inside the Claude app on Raider18 and isn't signed in, so no Gemini session can run yet.", how: "In a normal PowerShell: npm install -g @google/gemini-cli, then run gemini and choose Log in with Google. Then Fleet → Agents & fallback → Test." },
  { item: "Kimi CLI (if you want Kimi as a tool)", status: "optional", why: "Kimi is one of your subscriptions; its CLI isn't installed on any machine yet.", how: "Install Kimi CLI and sign in, then add it in Fleet → Agents & fallback." },
  { item: "inkling-2-mini on the stronger machines", status: "to do", why: "Routine run tasks can use it, on that machine and from the others.", how: "Run the installer on each stronger machine and tick “Routine-work model” (or Modify → Tools)." },
  { item: "OpenClaw gateway on Raider18", status: "decision", why: "Only one machine (Legion7) should poll the Telegram bot.", how: "Confirm it should run here, or turn off the “OpenClaw Gateway” task on Raider18." },
  { item: "WanGP MCP servers", status: "decision", why: "Two WanGP servers take about 8 GB on Raider18 whenever a Claude session loads them; memory is what crashed it before.", how: "Turn them off in Fleet → Setup when you're not generating video, or keep them." },
  { item: "Raider18's Claude login", status: "decision", why: "It is on a different Claude plan from the other machines.", how: "Confirm it's intended, or sign Raider18 in to the same account." },
  { item: "Node.js on the other machines", status: "optional", why: "Only Raider18 has the newer Node (24.22.3, seven months of fixes).", how: "Run the official Node 24 LTS installer on each machine." },
  { item: "Memory check for chats and Auto", status: "decision", why: "Chats and Auto can still load a local model without the new memory check.", how: "Say if you want the same check there." },
  { item: "Crash-dump registry setting", status: "optional", why: "Windows' own crash dumps for node.exe were turned on but can't catch a Node crash (ProcDump does instead). Harmless.", how: "Say if you want it removed (one admin prompt)." },
  { item: "First real Mac install", status: "to do", why: "The Mac installer's new option was tested with a simulated Mac only.", how: "Run it on a Mac and watch the “Local models” step." },
  { item: "Next build to choose", status: "decision", why: "Ideas not built yet: schedules aimed at a machine, run one prompt on every machine, session clean-up, a Node version column in Fleet → Setup.", how: "Pick one (or none)." },
];

// Changes to this document itself.
const HISTORY = [
  { date: "27 Nov 2026", change: "First version: changes from 24–27 November, findings, and what's waiting on you." },
  { date: "27 Nov 2026", change: "1.9: push a look to the whole Fleet; LevelUp's Fleet is live (merged after its full checks); Talos's notes now explain the fleet." },
  { date: "27 Nov 2026", change: "1.8: Appearance: customize everything (colours, fonts, sizes, background, menu, placement, saved looks)." },
  { date: "27 Nov 2026", change: "1.7: LevelUp hand-offs to the fleet, with client / personal areas; three new waiting items." },
  { date: "27 Nov 2026", change: "1.1: the GitHub dashboard; new waiting item: sign the GitHub CLI in to both accounts." },
  { date: "27 Nov 2026", change: "1.6: the Telegram gateway check in each machine's health." },
  { date: "27 Nov 2026", change: "1.5: all six machines updated to the latest version (done)." },
  { date: "27 Nov 2026", change: "1.4: Git Credential Manager fixed (done); Work brings a folder up to date with GitHub before starting a task." },
  { date: "27 Nov 2026", change: "1.3: Work, the repository task tracker with fleet assignment; new waiting item: Git Credential Manager." },
  { date: "27 Nov 2026", change: "1.2: GitHub sign-in done; the dashboard reports on every repository (23), not only active ones; waiting items ranked by whether they're addressed to you." },
];

// ─────────────────────────────── LAYOUT ───────────────────────────────

const FONT = "Calibri";
const ACCENT = "1F4E79";
const PAGE_W = 12240;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9360

/** "plain **bold** plain" → TextRuns */
function runs(text, base = {}) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") ? new TextRun({ ...base, text: part.slice(2, -2), bold: true }) : new TextRun({ ...base, text: part })));
}
const para = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run), spacing: { after: 120, line: 276 }, ...opts.paragraph });
const bullet = (text) => new Paragraph({ children: runs(text), numbering: { reference: "bullets", level: 0 }, spacing: { after: 80, line: 276 } });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });

const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const borders = { top: border, bottom: border, left: border, right: border };
function cell(content, width, { header = false, fill, span, bold = false } = {}) {
  const base = header ? { bold: true, color: "FFFFFF", size: 20 } : { size: 20, bold: bold || undefined };
  const paras = (Array.isArray(content) ? content : [content]).map((t) => new Paragraph({ children: runs(t, base), spacing: { after: 40, line: 252 } }));
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: span,
    borders,
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    shading: header ? { fill: ACCENT, type: ShadingType.CLEAR, color: "auto" } : fill ? { fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: paras,
  });
}
function table(headers, rows, widths) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, widths[i], { header: true })) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], { fill: ri % 2 ? "F2F6FA" : undefined })) })),
    ],
  });
}
const STATUS_FILL = { "to do": "FCE4D6", decision: "FFF2CC", optional: "E2EFDA", done: "D9D9D9" };

// ─────────────────────────────── BUILD ───────────────────────────────

function commits() {
  try {
    const out = execSync(`git -C "${repo}" log --since="${META.since}" --reverse --format="%h|%ad|%s" --date=format:"%a %d %b"`, { encoding: "utf8" });
    return out
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.split("|"))
      .filter((c) => !/^(NEXT-SESSION|Handoff:|Docs:)/.test(c[2]));
  } catch {
    return [];
  }
}

const children = [];
children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(META.title)] }));
children.push(para(`${META.period}  ·  updated ${META.updated}  ·  version ${META.version}`, { run: { color: "595959" }, paragraph: { spacing: { after: 240 } } }));

children.push(h1("Summary"));
for (const s of SUMMARY) children.push(para(s));

children.push(h1("Waiting on you"));
const open = WAITING.filter((w) => w.status !== "done");
children.push(para(`${open.length} item${open.length === 1 ? "" : "s"} open. “To do” needs an action from you; “decision” needs an answer; “optional” is up to you.`));
children.push(
  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2300, 1100, 2980, 2980],
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: ["Item", "Status", "Why", "How"].map((h, i) => cell(h, [2300, 1100, 2980, 2980][i], { header: true })) }),
      ...WAITING.map(
        (w) =>
          new TableRow({
            cantSplit: true,
            children: [cell(`**${w.item}**`, 2300), cell(w.status, 1100, { fill: STATUS_FILL[w.status] }), cell(w.why, 2980), cell(w.how, 2980)],
          }),
      ),
    ],
  }),
);

children.push(h1("At a glance"));
{
  const W = [CONTENT_W - 1300, 1300];
  const rows = [new TableRow({ tableHeader: true, cantSplit: true, children: [cell("Change", W[0], { header: true }), cell("Date", W[1], { header: true })] })];
  for (const sec of SECTIONS) {
    rows.push(new TableRow({ cantSplit: true, children: [cell(sec.title, CONTENT_W, { fill: "DEEAF6", span: 2, bold: true })] }));
    for (const it of sec.items) rows.push(new TableRow({ cantSplit: true, children: [cell(it.name, W[0]), cell(it.date, W[1])] }));
  }
  children.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: W, rows }));
}

children.push(h1("What's new, in detail"));
for (const s of SECTIONS) {
  children.push(h2(s.title));
  if (s.intro) children.push(para(s.intro, { run: { italics: true, color: "404040" } }));
  for (const it of s.items) {
    children.push(new Paragraph({ children: [new TextRun({ text: it.name, bold: true }), new TextRun({ text: `   ${it.date}`, color: "808080", size: 18 })], spacing: { before: 120, after: 40 }, keepNext: true }));
    children.push(para(it.what));
  }
}

children.push(h1("Worth knowing"));
children.push(para("Things the new features turned up about your setup:"));
for (const f of FINDINGS) children.push(bullet(f));

children.push(h1("Document history"));
children.push(table(["Date", "Change"], HISTORY.map((h) => [h.date, h.change]), [1800, CONTENT_W - 1800]));

const list = commits();
if (list.length) {
  children.push(h1("Appendix: every update this week"));
  children.push(para(`${list.length} updates since ${META.since}, oldest first (from the project's history on GitHub).`, { run: { color: "595959" } }));
  children.push(table(["Date", "Commit", "Summary"], list.map(([h, d, s]) => [d, h, s]), [1500, 1100, CONTENT_W - 2600]));
}

const doc = new Document({
  creator: "Mission Control",
  title: META.title,
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 44, bold: true, color: ACCENT }, paragraph: { spacing: { before: 0, after: 80 }, keepNext: true } },
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 25, bold: true, color: "2E75B6" }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }],
  },
  sections: [
    {
      properties: { page: { size: { width: PAGE_W, height: 15840 }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Mission Control · changes ${META.period}`, size: 16, color: "808080" })] })] }) },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
              children: [new TextRun({ text: `Updated ${META.updated}`, size: 16, color: "808080" }), new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: "808080" })],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const out = path.join(repo, "docs", "Mission-Control-Changes.docx");
fs.mkdirSync(path.dirname(out), { recursive: true });
const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
for (const name of Object.keys(zip.files)) if (zip.files[name].dir) delete zip.files[name];
fs.writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`wrote ${path.relative(repo, out)} (${list.length} commits in the appendix)`);
