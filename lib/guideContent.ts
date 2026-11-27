/**
 * The built-in user manual. Rendered searchably at /guide and exported to the
 * vault (Agentic OS/Guide.md) daily so agents can answer questions about the
 * OS itself via RAG. Keep keywords generous — they feed the guide search.
 */
export interface GuideSection {
  id: string;
  title: string;
  keywords: string;
  body: string;
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    keywords: "launch start open boot autostart shortcut port 3000 stop restart light dark theme toggle",
    body: `Mission Control is a local AI operating system: one dashboard that drives Claude Code, OpenClaw, Hermes, and any API LLM you add — with shared memory, missions, schedules, and an Obsidian knowledge graph underneath.

**Launching**
- It starts automatically when you sign in to Windows (hidden background server).
- The **Mission Control** desktop shortcut opens it (and starts the server if needed).
- Manual: run \`launch.cmd\` in the project folder, or \`npm run dev\` for development.
- **Stop it** with \`stop.cmd\`. The server binds \`127.0.0.1:3000\` only — nothing on your network can reach it.

**Theme** — the sun/moon button in the header toggles light/dark. Your choice is remembered per browser.

**New here? Press Help.** The **Help** button at the top right of every page (or **F1**) opens a side panel with: *This page* (what the page you are on is for and how to use it, step by step), *Start here* (a short tour and a "which page do I use for…" chooser), *How do I…* (searchable answers with a Go there button), *Glossary* (the app's words in plain language) and *Ask* (type a question in your own words; Claude Haiku answers from this manual, using a little of your Claude plan). A first-time visitor gets a small "New to Mission Control?" card pointing at it, once per browser.

**Finding your way** — press **Ctrl/⌘+K** for the command palette (jump to any page or agent) and **?** for the keyboard-shortcut overlay. The next section, *The Deck*, explains the visual language — what the colors, rings, and animations mean.

**After code changes** — the background server serves a production build; run \`npm run build\` then restart (stop.cmd → desktop shortcut) to pick up changes.`,
  },
  {
    id: "the-deck",
    title: "The Deck — Interface & Shortcuts",
    keywords: "interface ui visual colors accent hero strip nebula sky tint takeover empty state radar shortcuts overlay question mark ticker footer confetti celebration drag drop widgets heatmap funnel equalizer ring gauge",
    body: `The deck has a consistent visual language — once you can read it, every page explains itself.

**Colors mean location.** Every page owns an accent color. The page opens with an **identity strip** (page name + purpose, underlined by a scanning hairline in that color), the sky behind the panels tints toward it, panel titles carry a matching tick, and in light mode each panel's glass is tinted the same way. On **agent chat pages** (Auto, Claude, OpenClaw, Hermes, and any agent you've added) this goes further — a full **theme takeover**: the multicolor nebula crossfades out and a monochrome sky in that agent's color takes over. Navigate between two agents and watch the atmosphere shift.

**Shapes mean status.**
- **Stat tiles** glow from the corner in their metric's color; numbers animate to their values.
- **Ring gauges** fill with a fraction — fleet integrity on Overview, next-run countdowns on Schedule, SEO scores on Content. Lime is healthy, amber is degraded, rose needs attention.
- **Stage rails** (thin segment bars on Mission cards) show one segment per agent — lime done, amber running, rose failed — capped by a violet synthesis segment.
- A card that **breathes amber** is live right now (a running mission, or Pipeline's Human Gate holding items for you). An agent's **avatar pulses** while it's composing a reply.
- **Empty panels show a small radar sweep** ("scanning") instead of blank space — that means the feature works and simply has no data yet.

**Interactions.**
- **?** — keyboard-shortcut overlay · **Ctrl/⌘+K** — command palette · **Esc** closes either.
- The footer's left side is a **live ticker** of the latest event — click it to jump to the page it came from.
- On **Tasks**, drag cards between kanban lanes (the ◀ ▶ buttons still work); the target lane lights up as you hover.
- Finishing a task, landing a mission, shipping a pipeline item, or crowning an Arena winner fires a small **confetti burst** — automatically disabled if your OS requests reduced motion.

**Signature widgets** (each described in its feature's section): Pipeline's **Flow funnel**, Journal's **12-week writing heatmap + streak**, Analytics' **month-end spend projection**, Auto's **Recent Routes**, Arena's **VS strip + podium**, and JARVIS's **arc-reactor + live mic equalizer**.`,
  },
  {
    id: "appearance",
    title: "Appearance — Theme, Colors, Fonts & Layout",
    keywords: "appearance customize look feel theme dark light system palette colors missioncommand teal maroon plus jakarta sans neon deck ocean sunset forest pastel terminal monochrome font inter plex serif readable atkinson monospace size zoom scale density compact spacious sidebar icons right width corners rounded sharp panels glass solid outline flat glow shimmer animation motion reduced start page preset reset",
    body: `**Appearance** (Workspace → Appearance, or Ctrl/⌘+K → "appearance") changes the whole deck live — no reload.

**Default look: MissionCommand** — deep teal, maroon, gold, navy and green on light grey with white cards and a dark teal title band, set in **Plus Jakarta Sans** (numbers too; code and tool output stay monospace). Light mode by default; the same colors work in dark mode. Every browser was switched to it once; pick *Neon deck* to go back to the original. Each page's title band takes that page's own color. Charts: **Command** shows new sessions per day stacked by machine (last 14 days; hover a day for the breakdown, **Table** for the numbers) and 7-day mini bars in the Done today / Memories tiles; each **Projects** row has an 8-week strip of when its sessions were last active.

**Presets** — one click: *MissionCommand* (the default), *Neon deck* (the original dark neon look), *Calm*, *Terminal*, *Paper*, *Focus*, *Easy reading*. **Reset to default** undoes everything.

**Look** — Theme (dark / light / match system) · Color palette (MissionCommand, Neon, Ocean, Sunset, Forest, Pastel, Terminal, Monochrome — monochrome keeps amber/lime/rose so status still reads) · Background tone (MissionCommand teal, cool blue, neutral gray, warm, pure black/white) · Text contrast · Panel style (glass, solid, outline, flat) · Panel accent stripe · Corners (sharp → extra round) · Background effects (full, subtle, plain) · Glow and shimmer.

**Type** — Interface font (Plus Jakarta Sans, Space Grotesk, Inter, IBM Plex Sans, Atkinson Hyperlegible, Source Serif, Segoe UI, or monospace everywhere) · Code and data font (same as the interface — code stays monospace —, JetBrains Mono, IBM Plex Mono, Fira Code, Cascadia/Consolas) · Label style (SPACED CAPS or normal case) · Interface size (90–125%).

**Layout** — Density (compact, comfortable, spacious) · Sidebar (full, compact, icons only — hover an icon for its name) · Sidebar position (left/right) · Content width (focused, standard, full width) · Footer ticker.

**Behavior** — Animation (full; reduced stops looping effects; none) · Start page (Overview, Command, Timeline, Projects or Board — applied once per browser tab, so Overview stays reachable).

Settings are stored in this browser (\`localStorage\`: \`mc-appearance\`, theme in \`mc-theme\`) and applied before first paint, so there's no flash. Each machine/browser keeps its own look.`,
  },
  {
    id: "second-brain",
    title: "Second Brain — Command, Timeline, Projects, Fleet, Board",
    keywords: "second brain hub command center timeline activity stream projects fleet board sessions claude code codex kimi subscriptions usage limits rate limits native sessions machines accounts manager worker reviewer roles reply resume continue session full thread tool calls open terminal vs code folder hide move new session fork branch remote replies other machines",
    body: `The **Second brain** group at the top of the sidebar is one place for *all* your AI activity — not just what runs through Mission Control, but the Claude Code and Codex sessions you run anywhere on this machine (terminal, desktop app, IDE).

**Where the data comes from (read-only)**
- **Claude Code** — \`~/.claude/projects/**/*.jsonl\` (one file per session) and \`~/.claude/sessions/*.json\` (which sessions are open right now, busy or idle).
- **Codex** — \`~/.codex/sessions/**/rollout-*.jsonl.zst\` plus \`session_index.jsonl\` for thread titles. Codex also records your ChatGPT plan's **usage limits**, which power its subscription meter.
- **Mission Control** — chats, missions, orchestrations, approvals, Needs Attention, and \`Memory.md\`.
- Login files are never opened: not \`~/.claude/.credentials.json\`, not \`~/.codex/auth.json\`, not the \`.key\` files in \`~/.claude/sessions\`.
- Session history can be gigabytes, so summaries are cached in \`data/sessions-cache.json\` (per machine, safe to delete — it rebuilds). The first visit indexes newest-first for a few seconds per refresh; older sessions fill in over the next refreshes.

**The five pages**
- **Command** — status first: the **Health** panel, then running now, waiting on you, done today, memories saved today; Needs you, Live now, and subscription meters.

**Health** (top of Command) — checks the things that make Mission Control quietly stop working, every 10 minutes on every machine:
- **Claude Code CLI login** (claude auth status) — the CLI's own login, separate from the desktop app's. When it's signed out, agents, missions, scheduled jobs, Board and Group with AI all fail. Fix: run claude in a terminal and type /login.
- **Subscriptions, not API tokens** — agent CLIs (Claude Code, Codex, and any command agent) run on the login they were signed in with. Provider API keys in the environment or in .env.local (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, MOONSHOT_API_KEY, KIMI_API_KEY…) are **never passed to them**, so a key you added for Studio images or voice can't silently switch Claude or Codex to per-token billing. This check says which keys are being held back, warns if Claude or Codex is signed in with an API key instead of a subscription, and lists the agents you added by API key (those are billed by their provider). Only \`MC_ALLOW_API_KEYS=1\` in .env.local lets keys through, for a machine that really must run a CLI on one.
- **Hermes sign-in** — installed is not signed in. Hermes signs in to a provider of its own (Nous Portal, or a plan chosen in \`hermes model\`), and a signed-out Hermes looks fine until a run fails with "No access token found". This asks Hermes itself (\`hermes auth status\`) and tells you which command signs it back in.
- **Codex CLI login** (codex login status), **Scheduled jobs** (last run failed — the reason is now saved, not just "mission failed"; on a machine that isn't master these are shown as history), **Scheduler** (jobs overdue), **Obsidian vault**, **companion daemons** (Hermes, Ollama), **Watchdog** task, **Machine group** (offline machines, no master), **Free disk space**, **Memory** and **Fleet pause**.
- **Memory** — on Windows this is the *commit charge* (RAM plus page file), because that is how Windows actually runs out: it refuses memory at 100% even with RAM free, and Mission Control, Ollama and agent runs crash. Amber at 85%, rose at 93%, with the biggest users named (python and node show the script they run, e.g. *wgp.py ×2 7.7 GB* is WanGP's MCP server, which every Claude session that loads your MCP servers starts). Sampled every minute; Health re-runs at once when memory crosses a line.
- **Fleet pause** — amber while the fleet is paused (see below), so a forgotten pause is never invisible.
- All clear collapses to one line; problems open the panel with the fix and what stops working meanwhile. **Re-check** runs it now; **All checks** shows the passing ones too.
- **Machines** — each machine publishes its report to the vault (Agentic OS/Cluster/health), so you see the whole group's health from any machine. A machine shows "no report" until it runs this version.
- **Telegram alerts** (off by default) — one message when a check starts failing and one when it recovers, never repeats. Turning it on reports anything already failing once. Results live in data/health.json.
- **Timeline** — every action from every tool in one stream, filterable by tool, machine, project and **Started in** (Desktop app, Terminal, IDE, or Background — headless claude -p / codex exec runs, which is where Mission Control's own agents and schedules show up), with search. Session rows on Command, Timeline and Projects carry the same tag.
- **Projects** — the brain by project: every session in it from any tool (Claude Code, Codex and Hermes), with created / last changed / last opened times, memories that mention it, and a vault search scoped to it. You can work from it, not just read it:
  - **Click a session** to open it. You get the **complete thread**: every message and reply, plus every tool call (commands, file reads and edits, searches) as a collapsible row with its input and result. The newest 600 entries load first; **Load all** fetches the rest. While the session is open somewhere it refreshes every 10 seconds. Long outputs are clipped and likely secrets are redacted.
  - **Reply** — the box under the thread continues the real session with your subscription (claude -p --resume, codex exec resume, or hermes chat --resume), in the session's own folder. The reply is saved in the session itself, so the Claude app, the terminal, the Codex app or Hermes shows it too. **Hermes is different in one way:** it can't stop and ask, so a run started from here never gets Hermes's terminal, browser, desktop, scheduling or sub-agent tools at all. *Answer only* gives it the web and its memory; *Can edit files* adds file access and its skills. To let Hermes run commands, open the session in a terminal. **Answer only** (default) lets it read and answer, but refuses anything that needs approval; **Can edit files** allows file edits (commands still need approval). A Claude session that is open right now is continued **as a new branch** (--fork-session), so the two can't collide; you can also choose that for any session. Ctrl+Enter sends.
  - **Open in terminal** (resumes it interactively — Windows Terminal or Terminal on a Mac), **Open folder**, **VS Code**, **Copy resume command** (for running it on another machine), **Move to project…**, **Hide** (nothing is deleted; "show hidden" brings them back).
  - Project buttons: **+ New session** starts a Claude Code, Codex or Hermes session in the project's folder; **Terminal**, **Open folder** and **VS Code** open it on this machine.
  - **Sessions on your other machines** — you see the conversation they share (messages only). To also load their full thread, reply to them, or start sessions in their folders, THAT machine's **Replies from my other machines** setting (Fleet → Sharing across machines) has to allow it: **Answers only**, **Answers + file edits**, or **Off**. It is **on by default at Answers only**, so a machine that joins the group can be worked from the others straight away; a machine where you ever saved this setting keeps what you saved. Requests travel through the vault (Agentic OS/Cluster/requests/<machine>/), so anything that can write to your vault could use it — which is why the default lets a request read and answer but never do anything that needs approval, and why file edits stay a choice you make per machine. The machine only acts on sessions and folders it really has, uses the session's real folder (never one named in the request), and never grants more than its setting. Results come back through OneDrive, usually within a minute or two; unanswered requests expire after 30 minutes.
  - Runs started here are listed in data/session-jobs.json (at most 2 run at once per machine, 20-minute limit each).

**Sharing across machines** (needs the machine group on, Settings → Machines) — every 5 minutes each machine shares through the vault, so every Mission Control shows the whole group. No ports or server: it rides the same OneDrive sync as the vault.
- **Session summaries** (always, while the group is on) — titles, projects, folders, times, tokens, status and launch point of every Claude Code, Codex and Hermes session, plus subscription meters → Agentic OS/Cluster/sessions/<machine>.json. Timeline, Projects, Fleet and the Machine filter then cover all machines; Fleet's cells fill in with each machine's sessions and meters.
- **Conversations** (on by default, per machine) — your messages and the replies, without tool calls or tool output, with likely secrets (API keys, tokens, private keys, passwords) redacted → Agentic OS/Sessions/<machine>/<date> <title> <id>.md. They're ordinary vault notes: readable in Obsidian, found by vault search, usable as agent context. The **Read** button on a Fleet session row (and a session from another machine on Projects) opens one — live from this machine, or from the note another machine shared. Mission Control's own background runs are skipped (their results are already in the vault).
- **Tool memory** (on by default, per machine) — read-only copies of Claude Code's CLAUDE.md and per-project memory and Codex's AGENTS.md / memories → Agentic OS/Tool Memory/<machine>/. Originals are never changed.
- Already shared by the vault itself: Memory.md, your profile, journal, goals and Mission Control chat logs.
- Turn conversations or tool memory off per machine on Fleet → Sharing across machines; **Share now** runs a pass immediately. Health shows when this machine last shared and which machines it receives from. A machine running an older Mission Control shows dashed cells until you run update.cmd there.
- Renames and Group with AI on any machine apply to every session it can see, including other machines' sessions (stored in that machine's data/session-names.json).

**How sessions and projects get their names**
- **Session titles**, best first: your rename here → a rename in the Claude desktop app or /rename → Mission Control job name ("Chief of Staff · Nov 4") → Codex thread name → AI name → the auto-title → the first prompt.
- **Projects**, best first: your rename → the folder the session was started in, if it's a real project → the project folder holding most of the files the session read or edited (the outermost folder with .git / package.json / CLAUDE.md, so a monorepo's apps/web counts as the monorepo) → **Mission Control jobs** for scheduled runs → **Group with AI** → **Unsorted**. Home folders, Documents, desktop-app scratch folders and Codex Desktop's dated chat folders are never used as project names.
- **Group with AI** (Projects page) — one short Claude Haiku run on your subscription that puts Unsorted sessions into named projects and renames sessions whose title is really a pasted prompt. It never changes a name you set. Needs the Claude Code CLI signed in on this machine (run claude in a terminal, then /login).
- **Rename** — the ✎ next to a project or session name. Saving an empty name goes back to the automatic one. Renames and AI names live in data/session-names.json.
- **Sorting** — the Sort menu on Timeline, the project list, a project's sessions, Fleet's session list and Command's Live now: last changed, created, last opened, title, project, prompts, tokens or status (lists differ slightly). The arrow flips the order; "reset" goes back to the default. Time sorts keep Timeline's day headings; other sorts show one flat list. Your choice is remembered per list in this browser. Unsorted always stays at the bottom of the project list.
- **Times** — created = first message, last changed = last activity in the session file, last opened = when you last had it open in the Claude desktop app (only the desktop app records this).
- **Fleet** — machines × subscriptions. This machine's cells are live; other machines in the machine group show their heartbeat until session summaries are shared through the vault.
- **Board** — give the fleet a goal; the manager (Claude) splits it into subtasks, workers run them (Auto router or pinned agents), the reviewer (Claude) passes them or sends them back. Same engine as the Orchestrator on Tasks.

**Subscription meters** — ChatGPT/Codex shows real % used, window and reset time. Claude Code doesn't write its limits to disk, so its meter shows tokens used in the last 5 hours / 7 days instead. Kimi shows "not set up" until its CLI is installed.`,
  },
  {
    id: "fleet-control",
    title: "Run every machine's sessions from here — live view, alerts, LAN link",
    keywords: "team teammates roles hand off handoff channel mention fallback backup provider limit reached carry conversation acp agent client protocol gemini kimi goose qwen opencode send when free queue hold message wait live sessions stuck looping stop session needs you waiting permission alerts hook notification telegram browser notification long run finished lan off-lan network firewall 3101 peer direct onedrive fallback hand off move session another machine bring here run somewhere dispatch pick machine search all sessions saved filters bulk select hide move daily summary load cpu memory commit gpu ram crash pause fleet pause hold schedules resume setup mcp server plugin skills turn off disable wangp cli versions drift claude.md versions update all machines upgrade latest version github behind rollback self-update",
    body: `Everything below works across your machines. Machines on the same local network talk to each other **directly** (seconds); the rest go through OneDrive (1-2 minutes).

**Versions — update every machine from here** (Fleet → Versions)
- One row per machine: the version it is running (the commit it was built from, with its date), and how that compares with GitHub: *up to date*, *N commits behind*, or *local commits not on GitHub* (a machine where code was changed by hand, which is left for you to update yourself so nothing is lost). **Check GitHub** looks again now; otherwise it looks every 30 minutes.
- **Update** on a row (this machine included) asks that machine to update itself. It waits until nothing Mission Control started is running there (session runs, missions, orchestrations, project-run steps, agent processes) and starts nothing new while it waits; the row shows what it is waiting for. Then it gets the latest code from its own GitHub branch, installs packages if they changed, builds, and restarts through the watchdog, usually in 2-4 minutes. **Update all N behind** does every machine that is behind.
- **If the new version doesn't build**, the machine goes back to the version it had, rebuilds that and keeps running it; the row says so in rose. Its full output is data\\update.log on that machine.
- An update request carries no code and no commands: it can only make a machine install what is already on its own GitHub branch. Each machine decides for itself with **Updates from my other machines** (on by default; it also needs *Replies from my other machines* to be on).
- A machine on a version from before this feature shows *older — run update.cmd there once*. Double-click update.cmd in its Mission Control folder one time; from then on it can be updated from here. (Macs update through update.sh the same way, without the automatic going back.)

**Setup — every machine's AI tools side by side** (Fleet → Setup)
- Per machine: the versions of Claude Code, Codex, Hermes, Gemini, Ollama, Node and Git (amber = older than the newest in the fleet); its **MCP servers** (your own, ones that come with a plugin, and Mission Control's own); its **plugins**; how many **skills** it has, which skills the others have that it lacks, and which only it has; its Claude Code hooks; and whether its CLAUDE.md differs from most machines.
- **Turn an MCP server or a plugin off or on** by clicking it, then confirming. One of your own MCP servers is turned off with Claude Code's own command (claude mcp remove) after its settings are saved on that machine (data/mcp-parked.json), so turning it back on restores it exactly. A server that comes with a plugin is turned off with its plugin (claude plugin disable), which also turns off the plugin's skills. New Claude sessions get the change; sessions already open keep what they started with until they end. This is the way to stop WanGP's MCP servers (about 3.9 GB each, two on a machine with the local-media plugin) loading into every Claude session while you're not making video.
- On this machine changes apply at once. On another machine they need that machine's *Replies from my other machines* set to **Answers + file edits**, because they change its configuration; otherwise its card is view-only.
- **Copy a skill** to a machine that lacks it: its card lists the skills the others have as amber **+ name** chips; click one and confirm. It comes from this machine when this machine has it, otherwise from the first machine that does (fetched directly over the LAN). A **≠ name** chip on another machine's card means its copy of that skill isn't the same as this machine's; clicking it replaces theirs with this machine's copy, and theirs is kept in ~/.claude/skills-replaced there (outside the skills folder, so Claude doesn't load it). Only your own skills (~/.claude/skills) are copied; plugin skills come with their plugin. A skill can carry scripts Claude may run, so the receiving machine must allow **Answers + file edits**, and you should copy only skills you trust. Limits: 400 files, 8 MB; .git, node_modules and Python caches are left out; links are never followed. A copy is checked on arrival (no paths outside the skill folder) and moved into place in one step.
- **Local AI** — the models in each machine's Ollama, with their size on disk, so you can see which machines have a given local model (inkling-2-mini, say). "Ollama not running" can also mean an older version.
- Each machine shares its setup every 15 minutes (**Re-read this machine** does it now), as names and versions only: never an MCP server's settings, arguments or keys. A machine on an older version isn't listed until it is updated.

**Accounts — usage per login, not per machine** (Fleet → Accounts)
- The same Claude or ChatGPT login on several machines shares ONE set of limits, but each machine only sees its own sessions. Accounts adds them up: one row per login, with the tokens used on every machine in the last 5 hours and 7 days, and which machines use it.
- **The limit**: for ChatGPT/Codex, the newest usage figure any machine has seen (Codex records it in its session files), the window it belongs to and when it resets, plus *at this pace it fills in …* when the current rate would use it up before the reset. Claude Code doesn't record how much of its limit is used, but it does record the moment you hit it ("You've hit your session limit · resets 6:10pm"), so a Claude row turns rose with the reset time as soon as any machine on that login hits the limit.
- **Limited on one machine = limited on all of them.** Run somewhere and project runs treat every machine on that login as limited until the reset, and rank by the newest usage figure seen anywhere, so work isn't sent to another machine on the same exhausted account.
- How logins are matched: each machine shares a short fingerprint of its account id (a one-way hash; never the email, never a token). A machine on an older version reports none and shows as "this machine only" until it is updated.

**Remote actions — the log of what machines asked each other to do** (Fleet → Remote actions)
- Every request one machine makes of another is recorded on both ends: replies, new sessions, Stops, moving sessions, permission answers, updates, setup changes and skill copies, with where it came from, how it travelled (LAN or vault), whether it could edit files, and whether it was carried out, refused (and why) or ended with an error. Opening or reading a conversation isn't recorded.
- Each machine keeps its log in data/remote-actions.jsonl and shares its newest 300 entries in the vault (Agentic OS/Cluster/actions/) whenever something new was logged, at most every 10 minutes. This machine's own log is shown live.
- **Flagged** (rose): a request a machine carried out that names a sender whose own log shows no such request. Requests can travel through the vault's Cluster/requests folder, which anything syncing the vault could write to, so a flag means a request that machine never sent. It is only judged when the sender's log is recent and reaches back that far, so a machine on an older version (no log) or a slow sync raises no false alarm. Filters: **all**, **refused**, **flagged**.

**Network — LAN and Off-LAN** (Fleet → Network)
- Each Mission Control runs a small listener on **port 3101** that only answers other Mission Controls (they share a key kept in the vault, Agentic OS/Cluster/peer-key.txt). The app itself stays on 127.0.0.1:3000, unreachable from the network.
- Per machine choose **LAN** (direct, falls back to OneDrive when it can't be reached), **Off-LAN** (OneDrive only — a laptop away from home) or **Auto** (same as LAN). Machines report their own LAN addresses; you can also set a fixed address. The setting is shared by all machines.
- **What the status means.** Green *LAN ✓* = direct. Violet *other network → via OneDrive* = the machine is online but its address is not on this PC's network (typically it is plugged into a different router — for example the internet provider's own box rather than your main Wi-Fi — a guest network, or another building); everything works, 1-2 minutes slower; connect it to the same network to make it direct. Under each machine, **OneDrive: last heard from it N s ago** is when its latest heartbeat arrived here through OneDrive (it writes one every 30 s), so a small number proves that direction works. **Test OneDrive** checks both directions: it leaves a tiny test request in that machine's folder in the vault and shows "✓ round trip through OneDrive in …" when the answer syncs back (usually 1-4 minutes). Nothing is run on the other machine. A machine on older code answers "unknown request", which still proves the round trip. Amber = worth a look: *offline* (no heartbeat lately) or *LAN not answering* while on the same network (usually the firewall on that machine, or Mission Control not running there).
- Windows: the installer allows TCP 3101 in Windows Firewall on private/work networks (Windows asks for permission once — click Yes; on an existing install run the installer → Update, or Modify → Auto-start). Health shows **LAN link**: whether the listener is up, the firewall rule exists, and which machines answer.

**Command → Needs you, from every machine** (session alerts)
- A tiny hook (scripts/mc-hook.mjs) in Claude Code's settings tells Mission Control when a session **waits for you** (a permission prompt or a question), **finishes a turn**, or closes. Mission Control installs it on every machine and keeps your own hooks (Fleet → Session alerts → "Install the hook on every machine"; turn it off to remove it everywhere). Codex reports finished turns too, unless Codex already uses its notify setting for something else (the Codex app does on some machines).
- Needs you lists waiting sessions (until they move on, you dismiss them, or 6 hours pass) and **long runs** that finished (default 5+ minutes, with files changed). Click one to open the session; ✕ dismisses it.
- **Browser notifications** (per computer) and **Telegram** pings (sent by the master for every machine; off by default) are on Fleet → Session alerts.

**Command → Live sessions** — every open session on every machine: its current step ("Running Bash: npm run build"), the latest lines of its reply, how long this turn has run and its tokens. Flags: **Stuck?** (says it's working but nothing changed for 10+ minutes) and **Looping?** (the same tool call failed 3+ times this turn). **Stop** ends a session or a Mission Control run — it asks first when the session is open in the Claude app, a terminal or Codex (Codex app sessions must be stopped in the app).

**Command → Run somewhere** — describe a task, optionally pick a project and the tool; Mission Control ranks the machines (online, accepts work, has the project's folder, subscription not at its limit — counting the whole login, see Accounts — fewest busy sessions; LAN machines and this one preferred) and runs it on your pick. The result appears below and as a normal session in the project. An ACP agent (Gemini CLI, say) can be picked too: only machines that have it switched on qualify.

**Command → Team — named agents with roles that hand work to each other**
- Add a **teammate**: a one-word name (how you @mention it), a role (its instructions), a tool (Claude Code, Codex, Hermes or an ACP agent), a machine, a project folder and what it may do (Answer only / Can edit files, within what that machine allows).
- Write **@Ada fix the Safari sign-in test** in the channel. Ada's first message starts a real session for her, opened with her role and the team list; after that each message is a reply to her session, **held until it is free** (see *Send when free*). Every teammate's session is a normal one on the Projects page.
- **Hand-offs**: a teammate whose reply ends with a line **@Linus: review session.ts** hands that to Linus, whose reply can hand on again. A chain stops after **6 hand-offs** without you (the channel says so; reply to carry on), a teammate can't hand work to itself, and hand-offs are **held while the fleet is paused** (they are work nobody asked for directly). Your own messages always go.
- **Change the provider, keep the agent**: when a teammate's plan hits its limit and another tool takes over (see *When a plan hits its limit*), the teammate moves to the new session, keeping its name and role; the channel says "Ada now uses Codex". A local-model answer isn't saved in a session, so the teammate stays where it was.
- **New session** on a teammate's card starts it fresh (its role is sent again); changing its tool, machine or folder does too. **Clear** empties the channel, not the sessions.
- The channel and team list live on this machine (data/team.json); teammates can work on any machine that accepts requests from this one. Hand-offs are sent by the background tick, every 15 seconds.

**Send when free — a reply that waits for the session**
- Tick **when it's free** under a reply. Instead of going into a new branch now (what a reply to an open session does), the message is held on the machine that has the session until: no earlier message to that session is still running or waiting (they go **in order**), the session is closed in the app or terminal, and its plan isn't at its limit on that machine (it waits for the reset). Then it continues the session itself.
- While it waits, the bubble says what for ("waiting for the session to close", "for Claude's limit to reset (6:10pm)"), with **cancel**. After 24 hours it gives up and says so.
- A machine on an older version can't hold a message, so the box is greyed out for its sessions until it is updated.

**When a plan hits its limit — carry the conversation on** (Fleet → Agents & fallback)
- A reply or a new session that fails because its plan hit its limit (or the provider is overloaded) goes to the **next ready tool** in this machine's order (default: Claude Code → Codex → local model), in the same folder, with **the conversation so far** in its first message: who it is taking over from and why, the history (the newest kept if it has to be shortened, and it says so) and your message. It becomes a normal new session; the bubble says "Claude Code hit its limit, so Codex took over".
- **Ready** means installed, signed in (for Codex: its sign-in file exists; it is never read) and not at its own limit on this machine. Each step shows ready / why not; reorder with ↑ ↓, leave one out with ✕, add Hermes or an ACP agent with **+**. Hermes isn't in the default order because it may run on Nous credit.
- The **local model** only answers: it is never given a task that may edit files, gets a short version of the conversation, writes nothing to the shared memory, and no session holds its answer. With several local models, \`"local": "<model>"\` in data/worker-models.json picks which (inkling-2-mini, say).
- Each machine decides for itself: the fallback runs where the conversation was, with that machine's tools. Project-run workers are left out: runs place their own tasks and already skip a login at its limit.

**ACP agents — Gemini CLI, Kimi CLI, Goose and others as session tools** (Fleet → Agents & fallback)
- Agents that speak the **Agent Client Protocol** can be added per machine: presets for Gemini CLI (\`gemini --acp\`), Kimi CLI, Qwen Code, Goose and OpenCode, or any other with **custom command**. **Test** starts it and opens a session without sending anything, and says what it is, whether it can continue sessions, and, if it isn't signed in, how to sign in. (Verified with Gemini CLI 0.71.1; the other presets' arguments come from their documentation and aren't tested here.)
- Then **New session**, **Run somewhere**, **Team** and the fallback order can use it, and its sessions appear on the Projects page (ACP has no standard way to list an agent's sessions, so Mission Control keeps its own record of the turns it ran, in data/acp-sessions). A reply reopens the agent's own session when the agent can (\`session/load\`); otherwise the conversation is carried into a new one.
- **Install it from a normal PowerShell or Terminal**, not from a terminal inside the Claude desktop app: on Windows that app is packaged, so an \`npm install -g\` run inside it lands in the app's private folder, where only the app can see it. Mission Control looks there as a last resort, but a normal install is cleaner.
- **Sign-in is yours**, in the agent's own terminal (\`gemini\` → Log in with Google). Mission Control never signs an agent in: Gemini, for one, also offers a billed API key, and the rule here is plans, not per-token billing. API keys and Google Cloud project settings are stripped from what the agent is started with.
- **What it may do**: Mission Control answers the agent's permission requests for you. Answer only allows reading, searching and fetching; Can edit files also allows editing and moving files; running commands, deleting and anything it can't classify are always refused, and only ever "allow once" (an "always" answer could be saved in the agent's own settings). Files it reads or writes through Mission Control must be inside the session's folder. The reply lists what was refused. An agent whose own settings approve tools without asking isn't stopped by this, so check its settings.
- Another machine learns only each agent's id and name, never its command, and can't change a machine's list: commands are set on the machine itself.

**Projects**
- **Search every session on every machine** — messages, replies, commands, file names, errors. LAN machines search their full threads; Off-LAN ones their shared conversations.
- **Filters** — open/closed, machine, tool, where it was started; **Save filter** keeps one as a chip ("Open sessions on IdrisLegion7").
- **Select** sessions with their checkboxes to hide, unhide or move them to a project together.
- **Move to another machine…** (a Claude Code session on this machine) / **Bring to this machine…** (one on another machine) — copies the whole conversation into Claude Code there, with folder paths changed to where the project lives on that machine, optionally opens it in a terminal there, and hides the original. The project files aren't copied: the folder must exist there.
- Links like /projects?session=<id> (from alerts and notifications) open that session directly.

**What the other machine must allow** — replies, new sessions, full threads, Stop and moving sessions all need **Replies from my other machines** turned on on the machine that has the session (Fleet → Sharing): **Answers only** or **Answers + file edits**. Each machine only acts on its own sessions and folders and never grants more than its setting.

**Load per machine** (Fleet grid, under each machine's name) — CPU, memory and GPU, sampled every minute and carried in the heartbeat, so every machine sees every other's. Memory turns amber at 85% and rose at 93% (the commit charge on Windows; hover for RAM, commit, GPU memory and the biggest processes). Run work and **Run somewhere** use it: a machine whose memory is nearly full gets nothing new from another machine, and fuller machines rank lower. A machine on an older version shows no load until it is updated.

**Fleet pause** (Command → Fleet pause; a banner on every page while it lasts) — holds the autonomous work of EVERY machine for 1 hour, 4 hours or until you resume: no schedules, watchers, approved missions, pipeline builds, bridge work or profile refresh start, project runs don't advance, and queued run work waits. What is already running finishes; chats, replies, Run somewhere and missions you start yourself still run; updates (Versions) still run, so *pause → update all → resume* works. It is a file in the vault (Agentic OS/Cluster/pause.json), so every machine sees it within a minute or two and any machine can resume it. Health shows it in amber everywhere while it lasts.

**Daily summary** — each morning the master writes what every machine did yesterday to Agentic OS/Daily Summaries/<date> Machines.md (sessions per machine, projects, long runs, times sessions waited on you, runs started here). Preview it on Fleet → Session alerts; Telegram copy optional.`,
  },
  {
    id: "remote-control",
    title: "Remote Control: Live Sessions, Permission Prompts & Phone Access",
    keywords: "remote control live stream streaming watch session real time permission prompt approve allow deny always allow hook PermissionRequest phone mobile pin tailscale lan 3101 sign in drawer menu",
    body: `Manage Claude Code sessions on any machine as they run - from any machine on the LAN, or your phone.

**Watch live**
- A reply or new session started from Mission Control streams while it runs: the reply bubble shows each step (\`$ npm test\`, \`Edit page.tsx\`, searches) and the text Claude has written so far, updated about every second - on this machine or another one over the LAN.
- Open any session (Projects): if it's still running, the thread refreshes every few seconds ("● live"). Sessions on another machine are read straight over the LAN when it's reachable ("live from <machine> over the LAN"); otherwise use *Load full thread* (through OneDrive).

**Answer permission prompts from the app** (Fleet → Session alerts → *Permission prompts from the app*, shared by every machine)
- When Claude Code wants permission (run a command, edit a file…), a card pops up on every page of every machine's app: **Allow**, **Always allow** (adds Claude Code's suggested rule so it stops asking for that), or **Deny** - with a countdown and the full details.
- *Off* - answer at the machine; the app's own runs can't ask (anything needing permission is denied).
- *Mission Control's own runs* (default) - replies and new sessions started from the app wait up to 10 minutes for your answer. Terminal sessions answer in the terminal as usual.
- *All sessions, terminals too* - a terminal session waits the chosen time (15 s - 10 min) for your answer from the app, then shows its normal prompt. While it waits, the prompt isn't shown at the machine.
- Answering a session on another machine needs that machine's *Replies from my other machines* on (Fleet → Sharing). Optional Telegram ping when a prompt is waiting.
- How: Claude Code's PermissionRequest hook (installed with the alert hook, \`~/.claude/settings.json\`). If Mission Control isn't running, the hook steps aside at once.

**Phone access** (Settings → Phone access, per machine, off by default)
- Set a PIN (6+ characters), turn it on, and open the address it shows on your phone - e.g. \`http://192.168.4.28:3101/\` - on the same Wi-Fi/LAN. Sign in with the PIN; "Add to Home Screen" gives it an icon. On a phone the menu is a ☰ drawer.
- It uses the LAN link's port 3101 (already allowed in the firewall), so nothing new is opened. Every page works: sessions, live threads, replies, permission cards.
- Safety: sign-ins last 30 days in an HttpOnly cookie (only a hash is stored); five wrong PINs lock that address out for 15 minutes; a new PIN or *Sign out all devices* signs every phone out; turning it off answers "phone access is off".
- Away from home: install Tailscale on the computer and the phone and open \`http://<the computer's Tailscale IP>:3101/\` - no ports opened to the internet. (If Windows treats the Tailscale network as Public, allow port 3101 for it.)

**Compared with Claude's own Remote Control**: Remote Control attaches to one running terminal session (live typing, interrupt). Mission Control covers the whole fleet - every machine's sessions, live progress, permission prompts, replies, moving sessions - but a reply from here is a new turn in the session (\`claude --resume\`), not a keystroke into an open terminal. If a session is open in a terminal, reply with *Fork* or wait until it's idle.`,
  },
  {
    id: "agents",
    title: "The Agent Fleet",
    keywords: "agents fleet status orb online offline claude openclaw hermes deepseek llm sidebar",
    body: `Every agent gets its own chat page in the sidebar. Status orbs: **green** ready · **amber** working · **red** offline.

| Agent | Engine | Notes |
| --- | --- | --- |
| **Claude** | Claude Code CLI | The operator — full tools, file access, MCP servers, permission modes |
| **OpenClaw** | Gateway on this PC | Also lives on your Telegram (same brain, shared session memory) |
| **Hermes** | Nous Research agent | One-shot per message (no cross-message memory of its own) |
| **API LLMs** | Any OpenAI-compatible API | DeepSeek, Kimi, Grok, Gemini… added in Settings |
| **Auto** | Virtual router | Picks the best real agent per task (see Smart Routing) |

Every agent page has an **Activity Log** panel showing that agent's recent events. Agents that look offline right after a PC boot recover automatically within a minute (slow cold starts are re-probed).`,
  },
  {
    id: "claude",
    title: "Claude & Permission Modes",
    keywords: "claude bridge cli permission mode safe plan auto-edit full access bypass session resume model picker cost",
    body: `The Claude page pipes messages into the local \`claude\` CLI with live streaming — tool activity, session continuity, and real dollar costs per run.

**Permission modes** (toolbar above the composer) are the autonomy slider:
- **Safe** — tools that need approval are declined (default)
- **Plan** — read-only planning mode
- **Auto-Edit** — file edits auto-approved
- **Full Access** — every tool auto-approved. *Trusted prompts only — this can run commands on your PC.*

The **model picker** chooses Sonnet / Opus / Haiku per conversation. Sessions resume automatically across messages; the trash icon starts a fresh session. Each run's cost, tokens, and duration feed the Session Telemetry dials and the Analytics ledger.`,
  },
  {
    id: "telegram",
    title: "OpenClaw & Telegram",
    keywords: "telegram bot phone IdrisGV75_bot pairing approve reject remote message gateway",
    body: `OpenClaw's gateway connects to your Telegram bot (**@IdrisGV75_bot**). The dashboard's OpenClaw page and your Telegram chat share the same session — context carries across.

**From your phone you can:**
- Chat with OpenClaw normally
- **Answer approval requests** — when an agent requests a mission, you get a 🚦 notification; reply \`approve <id>\` or \`reject <id>\` and OpenClaw executes your decision against the local API
- Receive scheduled mission results and watcher alerts

The gateway runs as a Windows Scheduled Task (starts on boot). If the bot goes silent, check \`openclaw gateway status\` in a terminal. Note: only **dashboard** conversations are logged to the vault — Telegram-side chats live in OpenClaw's own memory.

**Sending and receiving are separate — this matters in a machine group.** Schedules, watchers and nudges run *only on the cluster master*, so the master is the machine that has to SEND. Set the bot token once in **Settings → This network → Telegram** (stored in the vault, so every machine that can become master has it — or per machine as \`TELEGRAM_BOT_TOKEN\` in \`.env.local\`) and it posts to the Bot API directly — no OpenClaw needed there, and no clash with the gateway (the single-consumer limit applies to polling, not sending). Without the token on a master that lacks OpenClaw, notifications fail *silently*: the send returns false and the run is still marked successful.

RECEIVING (answering approvals from your phone) needs the gateway, and **only one machine may poll the bot** — two conflict, Telegram 409s the loser. But the gateway no longer has to be the master: approvals live in the **shared vault** (\`Agentic OS/Approvals.json\`), so it can action an approval raised on any machine, and the master launches the resulting mission. Keep the gateway on whichever machine is most reliably on — that's usually the desktop, not the fastest laptop.`,
  },
  {
    id: "api-llms",
    title: "Adding LLMs (Kimi, Grok, Gemini…)",
    keywords: "add llm api key provider preset openrouter deepseek kimi moonshot kimi-for-coding coding plan subscription quota glm glm-5.2 z.ai zai zhipu coding endpoint grok gemini sakana fugu ultra cyber custom settings insufficient balance 402 401",
    body: `Settings → **LLM Connections** → pick a provider preset (OpenRouter, DeepSeek, Kimi, GLM, Grok, Gemini, Sakana Fugu, or Custom for any OpenAI-compatible endpoint), paste your API key, choose an accent color. The agent appears in the sidebar instantly.

- Keys are stored **server-side only** in \`data/registry.json\` (git-ignored, never sent to the browser).
- **To edit an agent**: click the pencil icon on its row in Settings → LLM Connections — every field is editable in place (name, provider, base URL, model, API key, system prompt, accent). Leave the key blank to keep the current one; tick **remove key** when switching to a keyless localhost endpoint. Switching accounts = paste the new key (and base URL if the provider changed).
- Error cheat-sheet: **401** = bad key · **402** = valid key, no credit (DeepSeek is prepaid — top up at platform.deepseek.com) · **429** = rate limit.
- **Gemini** has a free tier: aistudio.google.com, no card required.
- **Kimi — two different products, don't mix them up.** *Kimi for Coding (subscription)* is the flat-rate plan: base URL \`https://api.kimi.com/coding/v1\`, model \`kimi-for-coding\`, key from the **Kimi Code console**. It bills against a quota that refreshes weekly, **not** per token, so Auto treats it as the cheapest agent available (cost rank 1) — it's already paid for. *Kimi (Moonshot)* is the separate pay-per-token API at \`api.moonshot.ai\` with a key from platform.moonshot.ai. Different console, different key, different billing. The consumer **Kimi chat/assistant** subscription has no API at all and can't be connected to anything. ⚠ If you ever wire Kimi through **Hermes** instead, note its built-in \`kimi-coding\` provider hardcodes the *metered* \`api.moonshot.ai/v1\` base URL — you must override \`base_url\` to the coding endpoint or it silently bills per token.
- **GLM (Z.ai) — same trap, same shape.** Z.ai has **two OpenAI-compatible endpoints and they are NOT interchangeable**. *GLM Coding Plan (subscription)* = \`https://api.z.ai/api/coding/paas/v4\`, model \`glm-5.2\`, key from the **Coding Plan console** — flat monthly fee, so Auto ranks it cheapest (rank 1). *GLM (Z.ai) — pay per token* = \`https://api.z.ai/api/paas/v4\`, billed ~$1.40/$4.40 per M. Pointing a Coding Plan key at the general endpoint does **not** quietly bill you — it fails closed with **\`429 code 1113 "Insufficient balance or no resource package"\`**, because the Coding Plan doesn't fund the metered endpoint at all. If you see that error it's the wrong base URL, not a bad key: the same key works the moment you switch to \`/api/coding/paas/v4\`. The plan is **prompt-quota based, not unlimited** (Lite ≈ 80 prompts/5h) and GLM-5.2 burns **3× quota during 14:00–18:00 UTC+8** — a great default agent, a poor bulk worker. ⚠ Hermes's built-in \`zai\` provider also hardcodes the metered \`/api/paas/v4\`, so wire the subscription here in Settings rather than in Hermes.
- **Sakana Fugu** — key from console.sakana.ai, models \`fugu\` · \`fugu-ultra\` · \`fugu-cyber\`. Fugu is an *orchestrator*: one request fans out to several frontier models, verifies, and synthesises one answer. Sakana says it does **not** stack fees for that — "you pay a single rate based on the top tier model involved". Even so, at $5/M in and $30/M out Fugu Ultra is the **priciest agent in this fleet** (above Claude Opus 4.8's $25 out, ~10× GLM 5.2), so Auto is told as much (cost rank 10, above Claude) and won't reach for it to save money. A console.sakana.ai **subscription is not confirmed to cover API-key usage** — their pricing page lists "Pay as you go" and "Subscription" as separate things, so check the console before assuming your plan makes this flat-rate.
- **Ollama (local models)**: install from ollama.com, \`ollama pull gpt-oss:20b\` (14 GB; wants a GPU with 16 GB+ of memory — on a smaller machine pull a small model such as \`llama3.2\` instead and expect much less of it), then add a Custom LLM with Base URL \`http://localhost:11434/v1\`, model = the model you pulled, and **no API key** (localhost endpoints don't need one). Free, private, offline.
- **OpenAI / Codex models**: Custom preset with Base URL \`https://api.openai.com/v1\` + your OpenAI key. The Codex **CLI** plugs in as a Command Agent instead (template \`codex exec --skip-git-repo-check {input}\`).

Every API LLM automatically gets: shared memory + vault RAG context, **native function tools** (see LLM Tools), session compaction for long chats, voice in/out, and vault chat logging.`,
  },
  {
    id: "local-and-coding-agents",
    title: "Ollama, Codex & Local Models",
    keywords: "ollama local model llama qwen mistral free offline private lm studio codex openai cli coding agent gpt keyless no key localhost 11434",
    body: `**Ollama — free, private, offline models on your own hardware**

1. Install from **ollama.com**, then pull a model in a terminal: \`ollama pull gpt-oss:20b\` — the model the installer offers: 14 GB, good at ordinary tasks and at using tools, and it wants a GPU with 16 GB+ of memory (or an Apple Silicon Mac with 24 GB+). On less hardware pull something small such as \`llama3.2\` (2 GB), but know its limits: in testing it repeated a sentence it was asked to summarise and could not do a two-step sum. Coding-focused alternatives of similar size: \`devstral\`, \`qwen3-coder:30b\` (19 GB, tight on a 24 GB GPU)
2. If the installer pulled it, it has already added it to Mission Control for you (as "Local (gpt-oss 20b)") — skip to step 3. Otherwise Settings → Add LLM → provider **Custom**:
   - Base URL: \`http://localhost:11434/v1\`
   - Model: the model you pulled (e.g. \`gpt-oss:20b\`)
   - API key: **leave blank** — localhost endpoints don't need one
3. The agent appears in the sidebar instantly, with everything included: streaming chat, shared memory + vault RAG, the function-calling tool loop (tool-capable models like llama3.1+ and qwen2.5 can search your vault and file goals), Arena, MoA, debate, and Auto routing — at $0.00 per token.

Notes: local speed/quality depends on your hardware — 7–8B models run comfortably on 24 GB RAM. **LM Studio** works the same way (Custom, \`http://localhost:1234/v1\`, no key).

**Codex — OpenAI's coding agent**

- **Codex CLI** (the agent, like Claude Code): install (\`npm i -g @openai/codex\`) and authenticate (\`codex login\`, ChatGPT account), then Settings → **Command Agents** → name \`Codex\`, command template \`codex exec --skip-git-repo-check {input}\` (the flag is required — the app spawns it outside a git repo). It becomes a chat page, mission participant, and arena fighter. Note: OpenAI merged the Codex *desktop app* into the ChatGPT desktop app (July 2026) — the **CLI is separate, still maintained, and is what Mission Control uses**; desktop-app sign-in does NOT authenticate the CLI. Its green orb only means the binary exists — if runs 401, check \`codex login status\`.
- **OpenAI API models**: Settings → Add LLM → Custom → Base URL \`https://api.openai.com/v1\` + your OpenAI key. Full tool-loop citizen like any other API LLM.`,
  },
  {
    id: "llm-tools",
    title: "LLM Tools (Function Calling)",
    keywords: "tools function calling search_vault read_note save_memory add_goal list_goals append_journal request_mission agentic loop web_search brave internet web access",
    body: `API LLMs aren't just chatbots — each chat runs an agentic tool loop with native tools, executed locally:

| Tool | Effect |
| --- | --- |
| \`web_search\` | search the live web via Brave — **only appears once a Brave key is set** |
| \`search_vault\` | search your entire Obsidian vault |
| \`read_note\` | read any vault note by path |
| \`save_memory\` | write to shared memory |
| \`add_goal\` / \`list_goals\` | manage your goals |
| \`append_journal\` | timestamped journal entry |
| \`request_mission\` | request a background Claude mission — **goes through your approval gate** |

Tool activity streams into the chat as dim cards (call → result), then the model continues its answer. Models can chain up to 5 tool rounds. Providers without tool support get a transparent retry without tools.

**Web access is off by default.** Every tool above except \`web_search\` is local — nothing leaves the machine — which is why an API LLM will otherwise tell you it can't browse. Add a **Brave Search** key in Settings → Service Keys (or \`BRAVE_API_KEY\` in \`.env.local\`) and \`web_search\` is offered to every API LLM at once, no per-agent setup. Keys are per-machine, so do it on each. Free tier: 1 query/second, 2,000/month — a burst of parallel chats can trip a **429 rate limit**, which surfaces in the tool card rather than failing the whole reply. Until a key exists the tool isn't advertised at all, so models don't waste a round discovering it's missing. Claude and the command agents are unaffected — they bring their own web access.`,
  },
  {
    id: "auto",
    title: "Auto — Smart Routing",
    keywords: "auto router routing tier simple standard hard failover cheapest arena win rate health pool benched models in pool",
    body: `**Auto** is a virtual agent that picks the right real worker per task, **cheapest first and dearer only when the task asks for it**:

- **Simple** (short, factual) → the cheapest ready worker: **Hermes on a free Nous Portal model** (with web search switched on when the question needs current information), or a local model
- **Standard** → the best proven performer by Arena win-rate; until there is arena data, a subscription tool you already pay for (**Codex** on your ChatGPT plan), else Claude
- **Hard** (code, analysis, writing) → the reigning Arena champion; until there is arena data, the strongest tool available (**Claude**, or Codex if Claude is benched)

**Auto spends subscriptions and free models, not API credit.** A model you added by API key is billed by its provider, so Auto leaves it out of the pool until you opt it in: Auto page → **Who Auto Can Use** → tick the model. Local models (Ollama) are free and always eligible. You can still chat with a keyed model directly on its own page whether or not Auto may use it.

**Which Nous model Hermes uses** is chosen for you from Nous's public price list (refreshed twice a day, cached in data/nous-models.json): the free model for a task that needs no internet, the cheapest model that can make tool calls for one that does (Hermes reaches the web through tool calls; the free models can, so this is normally still free), with the next-cheapest as fallbacks because free tiers are rate-limited. Hermes's own default model is never inherited, and Claude or GPT models are never run *through* Nous — you already pay for those by subscription. To pin a model or park one that misbehaves, create data/worker-models.json: \`{ "routine": "<model id>", "web": "<model id>", "avoid": ["<model id>"] }\`.

It also reads the usage ledger for **health** — models failing more than half their recent runs are skipped — and if the chosen worker errors it **climbs one rung at a time**: another free worker first (a local model when Hermes's free tier is rate-limited or the machine is offline), then a subscription tool, then Claude. **Test failover** (Auto page → How Routing Works) proves it: it asks Auto a one-word question and tells the worker Auto picks to fail on purpose, then shows who answered instead. Nothing is changed, and the drilled failure doesn't count against that worker's health.

**Local models (Ollama).** Add one in Settings → LLM Connections (base URL http://localhost:11434/v1, no key) and it joins Auto's pool as a free worker and gets its own chat page. A local model can **read** shared memory and the vault but **cannot write** to them: it is not given the save-memory, goal, journal or mission tools and is not taught the OS-verb tags. (A 3-billion-parameter model, asked a plain question, saved a textbook definition to shared memory and announced it had done so.) Small local models are useful for look-ups and drafts and unreliable beyond that; with a strong GPU a larger model is worth pulling. Health is deliberately **recency-weighted**: a run's weight halves every 7 days, and same-outcome runs inside a 5-minute window count as *one* event. That matters because an outage fails however many jobs happened to be in flight — 11 missions dying in one minute is one broken credential, not 11 votes — and because a fixed agent should be able to prove it works again in a run or two rather than waiting a month for the average to recover. Every answer shows a routing line: who answered and why. Auto works in chat, missions, and schedules. It gets smarter as you crown Arena winners and accumulate usage data.

The Auto page keeps a **Recent Routes** panel — the last few routing decisions with the chosen model and the router's stated reason, so you can see the routing brain at work (and catch it picking expensive models for cheap questions).

**"N models in pool"** in the page header is the router's *live* pool, not a count of what you've configured — Claude plus every ready LLM, minus anything the health filter has benched. A **"· N benched"** suffix appears when models were skipped; hover the badge to see which ones and their success rate. So a low number means one of two different things: either that machine's registry is thin (**API keys are per-machine** — re-enter them in Settings after installing on a new machine), or a model has been failing and Auto stopped reaching for it. The pool is: Hermes on a free model (when Hermes is installed), Codex (when its CLI is installed), Claude, local models, and any API-key model you opted in. Talos and other command agents are not in it.`,
  },
  {
    id: "chat-features",
    title: "Chat Features (Voice, Markdown, More)",
    keywords: "voice mic speech dictation tts read aloud speaker markdown code table wikilink obsidian clear chat typing",
    body: `Every chat composer supports:

- **🎤 Voice in** — click the mic, talk, click again to stop. Browser-native, no API keys. Works on chats, goals, journal, memory, missions, and arena.
- **🔊 Voice out** — hover any agent reply for a read-aloud button, or flip the speaker toggle (top of the thread) to speak every new reply automatically. Markdown is flattened; code blocks are skipped.
- **Rendered markdown** — headings, tables, task lists, syntax-styled code. \`[[wikilinks]]\` are clickable and open the note **directly in Obsidian**.
- **Enter** sends · **Shift+Enter** newline · trash icon clears the chat (and Claude's session).
- The agent's **avatar pulses** while it's composing, and the whole page's sky wears that agent's color (see *The Deck*).

Long API-LLM chats **self-compact**: past ~16 turns, older messages fold into a rolling summary (you'll see a "context compacted" divider) so conversations never outgrow the model's context.`,
  },
  {
    id: "os-verbs",
    title: "OS Verbs (Agents Driving the OS)",
    keywords: "verbs remember goal journal mission tags harvest inline agent actions",
    body: `Any agent can drive the OS by including tags in a chat reply — the dashboard executes them and strips the tags:

| Verb | Effect |
| --- | --- |
| \`<remember>fact</remember>\` | saves to shared memory (attributed + wikilinked) |
| \`<goal>task</goal>\` | adds a checkbox goal in your active workspace |
| \`<journal>note</journal>\` | appends a timestamped note to today's journal |
| \`<mission>task</mission>\` | **requests** a background Claude mission — you approve first |

Try: *"add a goal to review the migration plan"* — the agent files it for real. Verbs only execute from interactive chats; mission outputs are never harvested (so agents can't recursively spawn missions).`,
  },
  {
    id: "missions",
    title: "Missions & Strategies",
    keywords: "missions orchestration moa mixture of agents pipeline debate single judge synthesizer verdict archive",
    body: `**Missions** (🚀 in the sidebar) run one task across multiple agents:

- **Mixture of Agents** — everyone answers in parallel; a synthesizer merges the best of each. Best for hard questions.
- **Debate** — two rounds (openings, then rebuttals) and a **judge** delivers a verdict + merged answer. Best for contested questions.
- **Pipeline** — agents run in your selection order, each improving the last output. Best for writing/code.
- **Single** — one agent.

Missions run **server-side** — close the tab, they keep flying. Each agent gets relevant shared memory injected. Results show per-agent timing and outputs (with \`auto → whoever\` routing labels), and every finished mission is archived to \`Agentic OS/Missions/\` in your vault with wikilinked attribution.

**Reading the Mission Log** — every card carries a **stage rail**: one thin segment per agent (lime done · amber running · rose failed) plus a violet cap for the synthesis/verdict step, so you can see exactly where a mission is without expanding it. Running missions **breathe amber**, working agents' avatars pulse, and a mission landing fires a confetti burst.`,
  },
  {
    id: "schedules",
    title: "Schedules & Prompt Variables",
    keywords: "schedule cron hourly daily weekdays weekly monday friday recurring librarian ops tuner chief of staff morning brief telegram delivery run now prompt variables recent_notes ops_digest today",
    body: `Switch the mission launcher to **"On a schedule"**: hourly / daily / **weekdays (Mon–Fri)** / weekly, delivered to **Telegram** or vault-only. The Schedules panel shows next-run time, last outcome, ON/OFF toggle, ▶ Run now, and delete.

**Prompt variables** (expanded at run time):
- \`{{today}}\` → the date
- \`{{recent_notes}}\` → digest of vault notes modified in the last 7 days
- \`{{ops_digest}}\` → usage/arena/evals/schedules/watchers operations summary

**Pre-installed:**
- **📚 Vault Librarian** (Sun 18:00) — reads the week's notes, writes a wikilinked Weekly Synthesis to Missions/; the weekly roll-up then lifts it into that week's note in Weekly/
- **🛠 Ops Tuner** (Sun 19:00) — reviews the ops digest and sends tuning recommendations to your Telegram

Schedules fire whenever the PC is on (30-second background tick). Claude (and the other command-line agents) run from inside the vault folder, so a prompt can name notes by their vault path, e.g. \`Workspaces/<name>/Project Overview.md\`.`,
  },
  {
    id: "watchers",
    title: "Watchers (Event Automations)",
    keywords: "watcher trigger event file folder goal done memory mention automation reactive cooldown",
    body: `**Watchers** (panel on the Missions page) fire a mission when something happens:

- **New file in a folder** — point it at any path (Downloads, an inbox folder…)
- **Goal completed** — fires when you check off a goal
- **Shared-memory mention** — fires when a new memory matches a keyword (or any new memory)

The mission prompt can use \`{{event}}\` for what happened. Results ping your **Telegram**. The first check silently baselines (no firing on pre-existing files), and a cooldown (default 10 min) prevents spam. Watchers run on the same 30-second tick as schedules.`,
  },
  {
    id: "conversations",
    title: "Searching Conversations",
    keywords: "search conversations chats history find topic keyword which agent when machine summary output open obsidian across agents locations",
    body: `**Conversations** (sidebar) searches everything you've discussed with every agent, by topic or keyword. It reads the daily chat logs in your vault (\`Agentic OS/Chats/\`), so it spans every agent and — because the vault is synced — every machine.

**What you get per result:** the agent, the date and time, the **machine** it happened on (🖥), your opening line as the title, a snippet with your keywords highlighted, and the word count. Expand any result to read the full exchange, then **Open in Obsidian** to keep working on that topic.

**Organize / filter:** click the **AGENT** chips to see only a given agent's chats, or the **MACHINE** chips to filter by where the conversation happened. Toggle **Exchanges** vs **Sessions** — Sessions groups a day's back-and-forth with one agent into a single card (with the exchange count and time range). Leave the search box empty to browse everything newest-first.

**AI summaries:** hit "AI summary" on any result (or "summarize N" to do a batch) to generate a one-line summary of what that conversation was about — cached so it's only generated once.

**Analytics tab:** switch to **Analytics** for the big picture — totals (exchanges, sessions, words, agents, machines), an activity-over-time chart, chats by agent and by machine, your most-discussed **topics** (click one to search it), and highlights (busiest day, top agent, deepest chat, avg words).

Chats are tagged with their machine automatically going forward; older exchanges from before this feature show as "unknown" machine but are still fully searchable.`,
  },
  {
    id: "install",
    title: "Install, update & uninstall (Windows and Mac)",
    keywords: "install installer setup exe windows mac macbook macos uninstall reinstall modify update repair new machine computer brew homebrew launchagent watchdog autostart start at login vault onedrive role primary backup workstation hermes openclaw codex ollama troubleshooting not recognized tracking information untracked",
    body: `One installer does everything on a machine: **install**, **update / repair**, **modify**, **reinstall** and **uninstall**. Run it again any time — on a machine that already has Mission Control it asks which of those you want.

**Windows**
- **MissionControlSetup.exe** — double-click. Windows may say "Windows protected your PC" because the file isn't code-signed: choose **More info → Run anyway**. It always fetches the newest installer from GitHub (or uses the copy inside it when offline).
- Or in PowerShell: \`irm https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.ps1 -OutFile "$env:TEMP\\mc-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\\mc-install.ps1"\`
- On a machine that already has it: double-click \`install.cmd\` in the Mission Control folder.

**Mac**
- In Terminal: \`curl -fsSL https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.sh -o /tmp/mc-install.sh && bash /tmp/mc-install.sh\`
- Or double-click **MissionControlSetup.command** (the first time: right-click → **Open** → **Open**, because it was downloaded).
- On a Mac that already has it: \`bash ~/Documents/mission-control/install.sh\`

**Choose what to install** — at the start of an install, update or reinstall, a checklist lists the optional parts: **Ollama**, its **local models**, the **Codex CLI**, **Hermes**, **OpenClaw** and (Windows) the **LAN link** firewall rule. Type a number to tick or untick it, Enter to continue. Everything optional starts unticked except the LAN link; items already on the machine are kept. Required parts always install: Git, Node.js, the app, Claude Code and auto-start. Unattended: -Components ollama,codex (Windows) or --components ollama,codex (Mac); "none" for only the required parts. Add things later with Modify.

**What a full install does** (each step checks first, so re-running is safe)
1. **Tools:** Windows — winget, Git, Node.js 22.15+; Mac — Homebrew (asks for your Mac password), Git, Node.js.
2. **Ollama**, and two separate items you can tick or leave: the **search model** (nomic-embed-text, 0.3 GB — makes vault search understand meaning; worth having everywhere) and the **local chat model** (gpt-oss:20b, a 14 GB download). The installer looks at the machine first: the chat model is pre-ticked only where it will run well (an NVIDIA GPU with 16 GB+ of memory, or an Apple Silicon Mac with 24 GB+) and is left unticked, with the reason shown, on anything smaller. You can still tick it there, or force it either way with \`-InstallChatModel\` / \`-SkipChatModel\` (\`--install-chat-model\` / \`--skip-chat-model\` on a Mac). Once it is pulled the installer also adds it to Mission Control as an agent ("Local (gpt-oss 20b)"), so there is nothing to set up in Settings; it does this again harmlessly on every run, never touches an agent that has an API key, and leaves registry.json alone if it cannot read it. An old local agent still pointing at llama3.2 is switched to the new model rather than duplicated. Set to start at login (Windows: Startup entry; Mac: \`brew services\`).
3. **The app** — clones from GitHub, or repairs an existing copy: re-links the branch to GitHub, switches to main, and moves hand-copied files that block the update into a \`mc-untracked-backup-…\` folder. Then \`npm install\` + build.
4. **Claude Code** (required) and **Codex** (optional) CLIs.
5. **The vault** — finds the OneDrive folder that contains \`Agentic OS\`, offers to pin it to the device (Windows; on Mac use Finder → "Always Keep on This Device"), and writes \`VAULT_DIR\` into \`.env.local\`.
6. **Machine group** — display name and role. **Workstation** (shares + works, never runs scheduled jobs) is the default; **Backup** also takes over jobs while the primary is down; only ONE **Primary** (Legion7 today).
7. **Companions** — offers the official **Hermes** and (on the primary) **OpenClaw** installers, with links; wires them into \`.env.local\`. See *Installing Companions*.
8. **Sign-ins** — opens the official \`claude auth login\` / \`codex login\` browser flows if signed out. The installer never sees a password.
9. **Starts automatically** — Windows: the "Mission Control Watchdog" Scheduled Task starts it hidden at login and restarts it within 5 minutes if it stops (no .vbs launcher, so Smart App Control doesn't block it); Mac: a LaunchAgent that starts it at login and restarts it if it stops. Mission Control itself then starts Ollama and Hermes's dashboard when it boots.
10. **Starts it now**, runs the **Health** check and opens Command. The summary lists anything left for you, plus optional next steps with links.

**The modes**
- **Update / repair** — newest code, fix git problems, rebuild, re-check everything. Same as \`update.cmd\` (Windows) or \`update.sh\` (Mac), which now repair the git link themselves.
- **Modify** — pick what to change: machine name/role, vault folder, tools (Codex, Ollama, models), companions (Hermes, OpenClaw), sign-ins, auto-start on/off, or update the code too. Everything else is left alone; Mission Control restarts so the change applies.
- **Reinstall** — moves the current folder aside (\`mission-control.old-…\`), installs a fresh copy, and carries over \`data\\\` and \`.env.local\` (your settings and keys). Delete the old folder once everything works.
- **Uninstall** — type UNINSTALL to confirm. Stops Mission Control, removes auto-start (and the watchdog on Windows), offers to take the machine out of the machine group (and optionally delete its shared conversations / tool memory from the vault), offers a **backup of data\\ and .env.local** (it contains API keys — keep it private), deletes the app folder, and optionally removes Codex / Ollama. Your vault, Claude Code, Git and Node are left alone.

**Flags** (Windows \`-Name\`, Mac \`--name\`): Mode install/update/modify/reinstall/uninstall · DryRun (show what would happen, change nothing) · Yes (accept defaults) · Label · Role · Vault · RepoDir · SkipModels · SkipOllama · InstallCodex / NoCodex · InstallHermes · InstallOpenClaw · NoCompanions · NoLogin · NoStart · RepairOnly (fix and update the code only).

**Troubleshooting**
- *"update.cmd is not recognized"* in PowerShell → run \`.\\update.cmd\` (PowerShell needs the \`.\\\`), or double-click it.
- *"'git' / 'npm' is not recognized"* → close the window, open a new one (so it sees newly installed tools), run the installer again.
- *"There is no tracking information for the current branch"* or *"untracked working tree files would be overwritten"* → run the installer and choose **Update / repair**; it fixes both.
- Pages say **Vault offline** → \`VAULT_DIR\` doesn't point at the folder containing \`Agentic OS\`; run the installer → **Modify → Vault**.
- Every run writes a log (the path is printed at the top and bottom of the window).`,
  },
  {
    id: "bridge",
    title: "Bridge for Claude Duet & OpenAI Dots",
    keywords: "bridge claude duet openai dots chatgpt dots proactive agent always-on onedrive sharepoint connector inbox outbox status.md task approval external agent integration",
    body: `**Claude Duet** (Anthropic) and **OpenAI Dots** are always-on cloud agents with no public API, so Mission Control can't connect to them directly. The **bridge** connects them through your OneDrive vault instead — no ports, no keys:

- **Agentic OS/Bridge/Status.md** — Mission Control writes it every 10 minutes: what needs you (approvals, waiting sessions, failures), sessions running on each machine, machine health, results from the last 24 hours, scheduled jobs and active projects.
- **Agentic OS/Bridge/Inbox/** — the agent drops a task as a Markdown file (optional \`from:\` and \`title:\` at the top, then the request in plain language).
- **Agentic OS/Bridge/Outbox/** — Mission Control writes the result under the same file name; its \`status\` moves through awaiting-approval → running → done (or failed / rejected / expired).
- **Agentic OS/Bridge/README.md** — the instructions, written for the agent.

**Setting it up**
1. In Claude Duet / your Dot, connect the **OneDrive / SharePoint** connector (Microsoft 365) so it can read and write the vault.
2. Fleet → **Bridge for Claude Duet & OpenAI Dots** → copy the sentence under "Tell Duet or your Dot" and send it to the agent.
3. Try it: ask the agent for "a summary of what my AI tools are doing" (it reads Status.md), or to "have Mission Control draft X" (it drops a task).

**Safety and limits**
- Only the **master** machine (Legion7) processes the bridge, so a task runs exactly once. Tasks run as a normal Mission Control mission on your subscription (Claude by default, or the Auto router).
- **Ask me before running a task** is on by default: each task becomes an approval (Command → Needs you, the approvals list on Overview, or Telegram). Turn it off only if you trust everything that can write to your vault.
- A **daily limit** (default 20) protects your subscription; extra tasks are rejected with a note. Requests over 8,000 characters are rejected. Files starting with \`_\` are ignored (drafts).
- Tasks are told not to send messages, pay, or delete anything.
- Duet and Dots' own conversations stay in the Claude and ChatGPT apps — the bridge carries tasks and status, not their chat history.
- Settings are shared by the whole machine group (Agentic OS/Cluster/bridge-settings.json); a task's state lives in its Outbox file, so the bridge keeps working if the master changes.`,
  },
  {
    id: "companions",
    title: "Installing Companions (Hermes & OpenClaw)",
    keywords: "install hermes openclaw talos telegram gateway companion agent setup npm venv approvals bot dashboard control room checklist full stack",
    body: `To run the full stack on a machine — Hermes (goal mode + Control Room) and OpenClaw/Talos (Telegram gateway + approvals) — install these two companions. They're optional: without them Claude, your API LLMs, and Ollama still work everywhere. Install them on **each** machine you want to run them (the group role doesn't install anything).

**Easiest way:** run the Mission Control installer again and choose **Modify → Companions**. It runs each project's official installer for you and wires the result into \`.env.local\`, so Mission Control starts Hermes's dashboard automatically. The **Health** panel on Command also lists any companion that's missing under **Optional installs**, with the exact command and links. Manual steps follow.

**OpenClaw (Talos) — Telegram gateway + approvals** · [install guide](https://docs.openclaw.ai/install) · [getting started](https://docs.openclaw.ai/start/getting-started) · [GitHub](https://github.com/openclaw/openclaw)
1. Install with the official installer — Windows PowerShell: \`iwr -useb https://openclaw.ai/install.ps1 | iex\` · Mac: \`curl -fsSL https://openclaw.ai/install.sh | bash\`. It provisions its own Node.js and starts the onboarding wizard. (Already managing Node 24.16+? \`npm install -g openclaw@latest --allow-scripts=openclaw\`, then \`openclaw onboard --install-daemon\`.)
2. Finish OpenClaw's onboarding (model/keys and main agent). \`openclaw onboard --install-daemon\` makes the gateway start automatically. Optionally name it Talos in \`~/.openclaw/workspace/IDENTITY.md\`.
3. Pair your Telegram bot with the gateway (bot token + your owner id).
4. In Mission Control's \`.env.local\`, uncomment: \`OPENCLAW_CMD=openclaw agent --agent main --message {input}\`
5. Teach it the approval protocol — add the "Mission Control" section to \`~/.openclaw/workspace/TOOLS.md\` (curl PATCH to \`127.0.0.1:3000/api/approvals\`) so you can approve missions from Telegram.
6. Start the gateway (\`openclaw gateway start\`, or its scheduled task). **Only ONE machine may run the Telegram gateway at a time** — two polling the same bot steal each other's updates.
7. Rebuild + restart Mission Control → the OpenClaw orb turns green.

**Hermes (Nous Research agent) — goal mode + Control Room** · [install guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation) · [GitHub](https://github.com/NousResearch/hermes-agent)
1. Install with the official installer — Windows PowerShell: \`iex (irm https://hermes-agent.nousresearch.com/install.ps1)\` · Mac: \`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash\`. On Windows it lands at \`%LOCALAPPDATA%\\hermes\\hermes-agent\\\` with a Python venv; its binary is \`…\\venv\\Scripts\\hermes.exe\`. (Antivirus sometimes flags its bundled \`uv.exe\` — see the install guide.)
2. In \`.env.local\`, set both (write the **full path** in each — this file does no variable expansion; adjust the username):
   \`HERMES_BIN=C:\\Users\\<you>\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe\`
   \`HERMES_CMD=C:\\Users\\<you>\\AppData\\Local\\hermes\\hermes-agent\\venv\\Scripts\\hermes.exe -z {input}\`
3. Confirm it runs: \`hermes --version\`.
4. Rebuild + restart Mission Control. Hermes turns green; Hermes Lab works and the Control Room dashboard **auto-starts** (the service supervisor launches \`hermes dashboard --skip-build --no-open\` on boot; there's also a Start button).

After either install, run \`npm run build\` and restart so the new \`.env.local\` is picked up.`,
  },
  {
    id: "multi-machine",
    title: "Multi-Machine & Sync",
    keywords: "sync onedrive obsidian sync multi machine second laptop network internet lan chats sessions shared brain vault_dir git pull update railway cloud hosting tailscale primary workstation conflict one engine",
    body: `Mission Control runs a **full instance on each machine**, all sharing one brain. Two channels do the work — and neither needs the machines on the same network:

- **GitHub** ships the *code*: set up a brand-new machine with the one-shot installer — \`install.cmd\` in the repo (or the public bootstrap one-liner in SETUP-NEW-MACHINE.md) installs Git, Node, Ollama, the app, models, Claude/Codex, and auto-start. To update an existing machine, double-click **\`update.cmd\`** in the repo — it runs \`git pull\` → \`npm install\` → \`npm run build\` and restarts the server. (Manual equivalent: \`git pull && npm install && npm run build\`, then restart.) Machines never talk to each other; each runs its own server at its own \`127.0.0.1:3000\`. After updating a *different* machine, re-enter its per-machine secrets in Settings (Studio API keys, WordPress connection) — those never sync.
- **OneDrive** ships the *brain*: the vault lives inside the OneDrive (LSI Media LLC) folder — \`…\\AI Mission Control\\IdrisGV75\` — so shared memory, RAG, goals, the task board, journal, chat logs, mission archives, and this Guide sync through the cloud. New machine = sign into the same OneDrive, sync the library, point \`VAULT_DIR\` in \`.env.local\` at it, and mark it "Always keep on this device".

**One sync engine, ever.** OneDrive is the chosen mechanism — leave Obsidian's built-in Sync core plugin OFF. Two engines rewriting the same files fight each other and breed conflict copies.

**Chats & sessions across machines** — three layers:
1. *Live threads and CLI sessions are per-machine* (Claude's resumable sessions live in that machine's ~/.claude).
2. *Chat records are shared* — every finished exchange lands in \`Agentic OS/Chats/\` and is readable anywhere (Library page) and searchable via RAG.
3. *The useful contents are shared* — memory facts, goals, journal entries reach every agent on every machine. End sessions with "Remember: … / goal / journal" and any machine picks up the thread.

**Deliberately per-machine:** schedules & watchers (one master runs them — duplicates double-fire), API keys, arena standings, and the usage ledger (each machine's Auto learns its own history).

**Machine group & master failover** (Settings → **Machine Group & Roles**) — instead of picking the master by hand, enable clustering and give each machine a role: **Primary** (preferred master), **Backup** (takes over if the primary goes down), or **Workstation** (never master). Machines coordinate through a lease file in the shared vault — the master renews it every ~30s; if it stops (machine off), a backup claims the expired lease and starts running the schedules/watchers/automations. It's eventually-consistent (OneDrive-synced), so failover takes a couple of minutes and a brief overlap is possible by design. The panel shows every machine, who's online, who holds master, and each install's folder; you can force "make this machine master" or "step down". With every component installed on each machine, a backup that takes over runs the full stack — schedules, watchers, Hermes, and Telegram delivery. Just keep only ONE Telegram gateway (OpenClaw) polling the bot at a time, since two conflict. Off by default — a lone machine just runs everything.

**Retiring a machine** — the trash icon next to a machine in Settings → Machine Group & Roles retires it: its heartbeat is removed and it's added to Agentic OS/Cluster/retired.json, which every machine reads. A retired machine never shows on Fleet, Health or Timeline's Machine filter, its shared sessions are ignored, and if it's ever switched back on it can't rejoin or become master. Activity it recorded earlier stays in your history, labelled "<name> (retired)" and filterable with Timeline's **Retired** chip. To bring a machine back, delete its entry from retired.json. (The GV75 desktop, DESKTOP-K82OGAE, retired 2026-08-27, is on the list. The vault folder "IdrisGV75", the @IdrisGV75_bot Telegram bot and the AIOSGV75 GitHub repo keep their names — they're still in use.)

**Two things that must be right on every machine that can become master**, because both fail *silently* otherwise:
1. **\`TELEGRAM_BOT_TOKEN\` in \`.env.local\`** — schedules/watchers/nudges run on the master, so the master is what has to send. Without the token on a master lacking OpenClaw, every notification vanishes while runs still record success.
2. **The install must be up to date.** A master running old code is the whole fleet's behaviour. Run \`.\\update.cmd\` after any change lands.

The **gateway** and the **master** are now independent — approvals are shared through the vault, so put the gateway on the always-on machine and let the fastest machine be master.

**Why not host it in the cloud (Railway etc.)?** The server is the engine room — it spawns local CLIs, reads the vault from disk, and talks to localhost Ollama; none of that exists in a cloud container, and the dashboard has no auth layer (it can run commands, so it binds 127.0.0.1 only). Remote access, when wanted, = **Tailscale** private mesh, not public hosting.

Full walkthrough for a new machine: **SETUP-NEW-MACHINE.md** in the repo.`,
  },
  {
    id: "new-network",
    title: "Set Up a New Network",
    keywords: "new network second office another lan new vault new onedrive new telegram bot botfather chat id owner name app name settings this network fresh workstations separate fleet",
    body: `One **vault = one network**. Every machine that uses the same OneDrive vault shares the brain, the machine group, sessions, the LAN link key and the network settings. To run a separate network (another office or LAN, other workstations, its own Telegram bot), give it its **own vault** — the app code is the same and updates from the same GitHub repo.

**First machine (becomes the primary)**
1. Sign in to OneDrive on the PC (the account that will own the new vault).
2. Run **\`1 - First machine - Start a new network.cmd\`** from the "Agentic Operations Control - New Network Installer" folder (or \`install.ps1 -NewNetwork\`, or the normal installer → type **N** at the vault step).
3. The installer installs everything, lists your OneDrive folders (including synced SharePoint libraries), creates the new vault folder, makes this PC the network's **primary**, and asks for: network name, your name, app name and subtitle, and (optional) the Telegram bot.
4. Optional: in Obsidian, *Open folder as vault* → the new vault folder.

**Telegram for the new network**
1. In Telegram open **@BotFather**, send \`/newbot\`, follow the steps → it replies with a **bot token**.
2. Paste it in the installer, or later in **Settings → This network → Telegram**.
3. Open your new bot in Telegram and press **Start** (or send it any message).
4. Click **Find my chat**, pick your chat, **Save**, then **Send test**.
The token is stored in the vault, so any machine that takes over as master can send. Replies from your phone (approvals, chatting with agents) need OpenClaw on the primary, paired with this same bot during \`openclaw onboard\` — only one machine may run the gateway for a bot.

**Each additional machine**
1. Give it the vault: same Microsoft account → it's already in OneDrive; a different account → on the first PC right-click the vault folder → *Share* (can edit), then on the new PC open OneDrive on the web → *Shared* → *Add shortcut to My files*.
2. Wait until the \`Agentic OS\` folder appears in File Explorer (right-click → *Always keep on this device*).
3. Run **\`2 - Add a machine to this network.cmd\`** (or the normal installer) and pick that vault. Role: *workstation* (or *backup* to take over jobs if the primary is down).
4. The installer adds the LAN link firewall rule; mark machines outside this LAN as Off-LAN on **Fleet → Network**.

**Change it later: Settings → This network** — network name, your name (used in agent prompts), app name and subtitle (header and tab title), Telegram bot token + chat, and this machine's vault folder (switch to another vault, or *Create a new vault here* to start a network from the app; then **Restart now**).

**What stays per machine**: \`.env.local\` (API keys; a \`TELEGRAM_BOT_TOKEN\` / \`TELEGRAM_TARGET\` set there overrides the network's) and the \`data\\\` folder (schedules, chats, settings). Schedules are per machine and run on the master — create them on the primary.`,
  },
  {
    id: "ops-pages",
    title: "Task Board, Schedule Calendar & Library",
    keywords: "tasks kanban board pending in progress done operator schedule calendar cron timeline next run library content docs documents viewer download obsidian ops pulse queue integrity disk uptime",
    body: `Three operations pages (inspired by command-center dashboards) round out the workspace:

**🛠 Tasks (/tasks)** — a personal kanban board: **Pending → In Progress → Done**, each lane color-coded (amber / cyan / lime). Add tasks with Enter, **drag cards between lanes** (or use ◀ ▶), delete on hover; dropping into Done fires confetti. The stat row shows board totals, scheduled-job count, and the **next cron countdown**. Stored in the vault as \`Agentic OS/Tasks.md\`, so it **syncs across machines** like shared memory and goals — and it's a normal Obsidian note: add a \`- [ ] task\` line under a lane heading by hand and the app adopts it; check a box in Obsidian and it lands in Done.

**📅 Schedule (/schedule)** — the cron calendar: every schedule grouped by frequency (hourly / daily / weekdays / weekly) with time, delivery target, and a **countdown ring** filling toward its next run; watchers listed alongside; a **7-day timeline** showing exactly what fires on which day, with today's row highlighted and a glowing marker tracking the time of day. Run-now and on/off toggles work right from the cards, and the **✎** beside a name renames that mission (each machine keeps its own copy of the schedules, so rename it on the master — the one that runs them). Creating/editing schedules still happens in the Missions launcher.

**📚 Library (/library)** — every markdown document the OS has written into the vault (mission archives, weekly syntheses, chat logs, journal, the Guide), filterable by folder, rendered in a full viewer with **open-in-Obsidian** and **download**. This is the "content folder" pattern: agents save long-form output to files instead of bloating chat context — and the Library is where you read it.

**Overview upgrades** — Host Vitals reports **disk usage** and **data-store size** alongside CPU/RAM/uptime (your VPS/Local Computer at a glance). **Ops Pulse** shows the mission queue (live pulse dots while work runs), today's runs with a 2-hour sparkline, today's errors, and fleet integrity as a **ring gauge** (lime/amber/rose by how many responders are up). **Needs Attention** shows a pulse-ring "ALL SYSTEMS NOMINAL" check when nothing is blocked on you. **Fleet Activity** charts 7 days of per-agent runs with success rates from the usage ledger.`,
  },
  {
    id: "studio-suite",
    title: "Mastermind, Builds, Goal Mode & Watcher",
    keywords: "mastermind group chat room agents mention builds games apps shelf play goal mode hermes autonomous long horizon walk away youtube watcher trends signals titles angles command palette ctrl k",
    body: `The studio suite — capability surfaces adapted from larger agent OSes, all on your local stack:

**🕹 Command palette** — press **Ctrl/⌘+K** anywhere to jump to any page or agent by name. Fuzzy match, arrow keys, Enter.

**🗣 Mastermind (/mastermind)** — one room, every agent, each a *different real model*. They reply **in turn** (not in parallel), so each sees the earlier replies and genuinely riffs or pushes back — name an agent with **@claude** to ask just them. Vault-aware, history saved. Best for "what should I build next?" or stress-testing a decision from many model-perspectives at once.

**🛠 Builds (/builds)** — commission a single-file HTML **game or app**; Claude writes it (no libraries, no external calls), it saves to your vault under \`Agentic OS/Builds/\`, and you **play it in-place** in a sandboxed frame or pop it out to a tab. The shelf syncs across machines like everything else.

**🎯 Hermes Lab (/hermes-lab)** — two tools for the Hermes agent:
- **Goal Mode** — hand Hermes a long-horizon goal; it runs \`hermes chat --yolo --max-turns N\` autonomously in its own scratch directory. Output tails live, files it writes show up as artifacts, and you get a Telegram ping when it finishes. Set the target, walk away.
- **Control Room** — embeds Hermes's *own* native dashboard (sessions, models, files, logs, cron, skills, plugins, MCP). Run \`hermes dashboard\` in a terminal and it appears here — the full native interface, finally exposed.

**📡 YouTube Watcher (/watcher)** — keyless trend radar. Add channel IDs (UC…) and boost keywords; it reads each channel's public RSS feed (no API key), scores recent videos by recency · keyword · views, and a cheap agent drafts **5 titles + 3 angles** per signal. Rescans every 4h on the scheduler and logs each sweep to the vault. Click a signal's dossier for copy-ready titles.

**📥 Pipeline (/pipeline)** — from inbox to shipped, one human checkpoint. Drop any idea; Claude classifies it (project · action · idea · reference · escalate) with a confidence score and tags. Small items file straight to your vault journal; **projects wait at the Human Gate for your one Approve**, which launches an Orchestration to build the deliverable — then it lands in Shipped & Filed with the result (plus confetti). The board self-advances as builds finish. The **Flow funnel** up top shows counts per stage at a glance, and the Human Gate column breathes amber while anything waits on you.

**🎙 JARVIS (/jarvis)** — a voice command center for the whole OS. Click Start listening (Chrome/Edge) and speak: say "go to watcher" / "open the pipeline" to navigate, or ask anything ("what should I build next?") and the Auto agent answers out loud. The **arc-reactor rings** spin up while it's active — lime for listening, magenta for speaking — and the **equalizer bars follow your real mic level** while you talk (they simulate during speech playback, or if mic access is denied). Optional "Jarvis" wake word, selectable voice, tappable example commands, and a typed fallback. Built on the browser's Web Speech + Web Audio APIs — no keys.`,
  },
  {
    id: "studio",
    title: "Creative Studio (Image · Voice · Video)",
    keywords: "studio image voice video generate art dall-e gpt-image openai elevenlabs tts text to speech replicate render media api key paid creative",
    body: `**Studio** turns prompts into media — pictures, spoken audio, and video — using paid provider APIs. Three tabs, one gallery each; everything is saved into the vault under \`Agentic OS/Studio/\` (images/ · audio/ · video/) so it syncs across machines.

**Connect a provider first.** Studio needs an API key per medium. Add keys in **Settings → API Keys — Creative & Integrations** (or set the env var as a fallback). A tab with no key shows a "🔑 Add a key in Settings" prompt and its orb stays red.

| Medium | Providers | Get a key | Env fallback |
| --- | --- | --- | --- |
| **Image** | OpenAI (gpt-image-1, DALL·E 3) · Google Gemini (2.5 Flash Image, “Nano Banana”) | platform.openai.com/api-keys · aistudio.google.com/apikey | \`OPENAI_API_KEY\` · \`GEMINI_API_KEY\` |
| **Voice** | OpenAI TTS · ElevenLabs | platform.openai.com · elevenlabs.io | \`OPENAI_API_KEY\` · \`ELEVENLABS_API_KEY\` |
| **Video** | Replicate (any text-to-video model) | replicate.com/account/api-tokens | \`REPLICATE_API_TOKEN\` |

**Using it**
- **Image** — type a prompt, pick a provider. OpenAI adds size (square/landscape/portrait) + quality controls; Gemini composes straight from the prompt (describe the framing you want). Result appears in the gallery in ~10–30s.
- **Voice** — type the text to speak, pick an OpenAI voice (alloy, nova, …) or paste an ElevenLabs voice id, Generate → an audio player.
- **Video** — prompts render on Replicate's servers and take minutes; the card shows **generating** and fills in when done (billed per second). Set the model, e.g. \`minimax/video-01\`.

Each item has download and delete. Costs are estimated into the usage ledger, so Studio spend shows up in **Analytics**. One OpenAI key covers both image and voice.`,
  },
  {
    id: "history-import",
    title: "Importing AI Chat History",
    keywords: "import history chatgpt claude export conversations.json distill second brain memory ingest past chats zip llm-exports",
    body: `**Import** folds your past ChatGPT and Claude conversations into Mission Control's brain, so your agents start "knowing what you've already worked through" instead of cold.

**1. Export your data** (each provider's official download):
- **ChatGPT** → Settings → Data Controls → Export data → you get an emailed ZIP with \`conversations.json\`.
- **Claude** → Settings → Privacy → Export data → a ZIP with your conversations.
- Both take minutes to a few hours to arrive.

**2. Drop it in the exports folder** — default \`Documents\\llm-exports\` (override with \`LLM_EXPORTS_DIR\`). You can drop the whole ZIP (it auto-extracts on Windows) or the extracted \`conversations.json\`. Both providers' files are detected automatically, and **size is not a limit** — exports are streamed, so a multi-hundred-MB \`conversations.json\` (years of history) scans fine. If a file genuinely can't be read, the Found panel says so in red rather than quietly ignoring it.

**3. Scan** (free, local) — parses everything into a preview: how many conversations per source, total messages, and the date range. Nothing leaves your machine.

**Distilled history is searchable in Conversations.** Once distilled, every topic from your imported history is indexed on the **Conversations** page alongside your live chats — filter to the **History** agent chip, or just search a term and look for the violet **IMPORTED** badge. You're searching the *distilled topics* (decisions, durable facts, tags), not raw transcripts — and because the notes live in the vault, this works on **every machine in the group**, not just the one you imported on. (The raw exports and the "already processed" index stay machine-local.) Conversation **Analytics** counts live chats only — thousands of history topics all stamped with their distill date would bury the real activity trend.

**Duplicates are handled for you.** Drop as many exports as you like — overlapping, re-downloaded, years apart — and the scan deduplicates in two passes: by conversation **id**, then by **content fingerprint** (the opening message), which catches the same chat re-exported under a *new* id. In both passes the **richest copy wins**, so re-exporting a conversation you've since continued upgrades the record rather than keeping the stale one. Two genuinely different chats that merely open with the same short "hey" are never merged. The scan reports how many duplicate copies it skipped.

Better still, **"already distilled" is remembered by content, not just id** — so a conversation you distilled months ago won't be distilled again just because a fresh export gave it a new id. You can re-download your full archive any time and safely re-run; only genuinely new conversations cost anything.

**4. Distill** (uses an agent, bounded) — the chosen **writer** (Claude for best quality and speed, DeepSeek for cheap, Llama/Ollama for free-and-local — but note a CPU-bound local model can exceed the 3-minute per-call timeout on dense batches, so it suits small runs rather than a whole archive) condenses your conversations into topic-grouped Markdown notes — durable facts, decisions, and preferences — saved to the vault under \`Agentic OS/History/\`. It runs the richest conversations first in batches of 12 (one writer call per batch); set a **max per run** so cost stays bounded, or tick **EVERYTHING** to walk the whole archive in one go — the UI shows roughly how many writer calls that means before you commit. Either way it's **resumable** — re-run to continue where it left off. "Reset processed" re-opens everything for a fresh pass.

**How the notes join your brain:**
- **Tags** — each note carries \`tags: [...]\` in its frontmatter (3–8 kebab-case topics the writer chose), so Obsidian's tag pane and searches find them.
- **Wikilinks** — the writer is shown your existing vault note names and links topics into them with \`[[Note Name]]\` where they genuinely relate (it's instructed never to invent a link to a note that doesn't exist).
- **An index hub** — every run also writes \`Imported History Index <date>\`, listing each note wikilinked with its topics and tags. That single hub is what pulls the whole import into the knowledge graph as a cluster rather than a pile of orphans — open \`/graph\` after a run and you'll see it.

**Which machine?** Any — but only **one**. The raw exports and the "already processed" index are **per-machine** (they never sync), while the distilled notes go to the **shared vault**. So import on one machine (the desktop is the natural choice) and all your machines get the resulting brain. Running it on two machines would distill the same conversations twice.`,
  },
  {
    id: "content-pipeline",
    title: "SEO Content Pipeline & Publishing",
    keywords: "content seo blog article writing publish wordpress draft keyword meta description slug rank hero image export markdown html",
    body: `**Content** turns a keyword into a ready-to-publish blog article. Give it a target keyword, pick a writer (Claude, Auto, or any agent), and it drafts an SEO-optimized piece: title, meta description, slug, secondary keywords, a structured Markdown body, and a hero-image prompt. Articles save to the vault under \`Agentic OS/Content/\` (with YAML frontmatter) so they sync everywhere.

**SEO score** — every draft is graded against a local 9-point checklist (no API): keyword in title/meta/intro, title & meta length, H2 count, word count, clean keyworded slug, secondary keywords. The score (0–100) shows on each card; expand an article to see which checks passed.

**Hero image** — one click generates a hero via the Studio image engine (needs an OpenAI or Gemini key). It's stored with the article and shown in the detail view.

**Getting it out**
- **Export** — download the Markdown, or copy clean HTML to paste anywhere.
- **Publish to WordPress, Ghost, or Webflow** — connect any (or all) in **Settings → Publishing**. WordPress = site URL + username + an **Application Password** (WordPress → Users → Profile). Ghost = site URL + an **Admin API key** (Ghost Settings → Integrations → Add custom integration; the \`id:secret\` string). Webflow = an **API token** (Site settings → Apps & integrations) + the CMS **collection ID** + the slug of the rich-text body field (default \`post-body\`). Each connected target gets its own "Push to …" button on every article; every push lands **as a draft** (you review and publish inside the platform). Credentials live in \`data/publish.json\` (git-ignored) or env fallbacks \`WP_*\` / \`GHOST_SITE\`+\`GHOST_ADMIN_API_KEY\` / \`WEBFLOW_TOKEN\`+\`WEBFLOW_COLLECTION_ID\`+\`WEBFLOW_BODY_FIELD\`.

Without a publishing connection the pipeline still works end-to-end — you just export instead of pushing.`,
  },
  {
    id: "orchestrator-attention",
    title: "Orchestrator & Needs Attention",
    keywords: "orchestrator chief of staff delegate goal decompose dispatch review rework assemble subtasks auto route cheap tokens conserve needs attention stalled blocked waiting pending nudge reminder",
    body: `**🧭 Runs** (sidebar → Runs) is for a real project: describe it, and it is planned into tasks, each task is done by a **real session** (Claude Code, Codex or Hermes, in a folder, able to edit files when you allow it), reviewed, sent back or moved to a stronger worker, and delivered.

- **Start a run** — write the brief, pick where it works (a project's folder on a machine that has it, or a home folder), pick who plans (Auto gives planning to Claude; Hermes plans on a free model), and tick *Tasks may edit files there* only if they should. Unticked, every task answers in text and changes nothing.
- **You approve the plan** before any worker starts — on the Runs page, in Needs you, or from Telegram ("approve <id>"). Open a task to read exactly what its worker will be told and how "done" is defined.
- **Cheapest worker that fits.** Each task has a tier. *Routine* (look up, summarise, draft, simple edits) goes to Hermes on a free Nous model; *standard* to Codex; *hard* to Claude.
- **The local model goes first on the smallest jobs.** If the machine the run works on has a local model (Ollama) registered and running, a routine task that only needs text — no web, no files, no checks, and a short brief — is first given to it: free, seconds, and nothing leaves the PC. It gets one plain request with no tools and no access to shared memory, and its answer is reviewed like anyone's. If the reviewer turns it down the task goes to Hermes as usual with all its attempts still available, and is shown what the local model wrote and why it was rejected. To keep runs off the local model, put \`"local": false\` in data/worker-models.json. With several local models registered (Llama and inkling-2-mini, say), \`"local": "inkling-2-mini"\` there says which one does this work (a registry LLM's id, name or model); unset, it is the first registered local model that is actually running. The local model used is the one on the machine the run works on. Runs show these tasks as done by "Local model". A task that has to **read the project's files** but not change them (the plan marks it *reads folder*) skips both the local model and Hermes, because neither can read files in answer-only mode, and starts at Codex. Within the Claude plan, routine and standard work use the smaller Claude models. A tool that isn't installed on that machine, or whose plan has hit its limit, is skipped.
- **Review from above, and escalation.** A routine task is reviewed by Codex, everything else by Claude. Rejected work goes back to the same session with the reviewer's words (Claude, Codex and Hermes all keep their session for rework); a task rejected twice at one tier is retried one tier up by a fresh worker that is shown the rejected output. After four attempts a task is marked failed and the run carries on with the rest.
- **Guards.** A Hermes worker is limited in tool-calling rounds (20 for routine work) and every worker has a time budget by tier (8, 15, 19 minutes). A Claude worker on standard or hard work that runs out of time is stopped and told to carry on **in the same session**, with everything it did (files included) kept — twice for free, then as counted attempts — so long work can outlast one sitting. Any other worker past its budget is stopped and the task moves on. Hermes workers never get a terminal, and a run's Hermes workers get no Hermes memory or past-session search. A run's Claude workers, planner and reviewer start without your Claude MCP servers, which can take gigabytes of memory per run and aren't needed there.
- **It survives restarts.** A run's state is a file in your vault (Agentic OS/Runs/<run>/run.json, with a readable Run.md, a Log.md, one note per task and the final Delivery.md). The machine that started a run advances it every 20 seconds and simply carries on after a restart. Pause, Resume and Stop work from any machine.
- **Checks: proof, not opinion.** For a project folder you can list commands this machine may run to prove a task — a test run, a build, a type check (Runs → tick *Tasks may edit files there* → **Checks for this folder**; **Try it** runs one now so you know it works here). The plan can then require them on tasks that change files. When such a task's worker finishes, Mission Control runs those commands **itself**; the task only goes on to review if they pass, and the reviewer sees the results. A failed check goes back to the worker with the end of the command's own output. The list is per machine and can only be changed on that machine's Runs page: a plan, a worker or another machine can *name* a check, never add a command. Know what you are allowing: a check runs whatever that command does in the folder, including code a worker just changed. Checks run only when a run works on the machine that started it.
- **Planner and reviewer read the real files.** For a run in a project folder on this machine, both start in that folder and can read it, so the plan fits what is there and the review judges what is on disk rather than the worker's description. Neither can run commands or change files — which also means neither can stall waiting for you to answer a permission prompt.
- **What "reviewed" means:** a second model read the output (and the files). The delivery states per task whether it *passed checks Mission Control ran* or was *reviewed only*, and a task accepted because its reviewer failed is labelled *not reviewed*.
- **Spread over my computers** (on by default when you start a run). When the machine a run works on is busy, an answer-only task can go to another of your computers: one that is online, accepts work from the others (Fleet → Sharing → Replies from my other machines), has the project's folder (or the run works in a home folder), has the tool set up and not at its limit, and runs this version or newer. The cheapest tool still wins; machines only compete for it, and a computer reached only through OneDrive is picked only when the others are much busier. Tasks that edit files or must pass checks always stay in the chosen folder. A computer that doesn't start a task within 4 minutes (LAN) or 12 minutes (OneDrive) is skipped for that task and the task goes elsewhere, with no attempt used up. Each task shows where it ran. A computer running an older version never gets run work, because it may ignore a run's model choice and limits.
- **Runs learn.** Every attempt leaves a note on its task (who did it, at what tier, on which machine, how it ended; open a task to see them). At delivery, what went wrong (rejections and why, failed checks, tasks moved up a tier, computers that didn't pick work up) is written to the run's Lessons.md and added to a file per project in Agentic OS/Runs/Lessons/. The next run for the same project gives its planner the end of that file, plus each worker's record: how often its attempts passed review, by tier, over recent runs (also shown on the Runs page as **Worker record**). Lessons files are yours to edit or prune; nothing is written into Rules.md or shared memory.
- **A git branch per run.** When a run that may edit files works in a git repository with nothing uncommitted, it first makes its own branch (mc/run-…). Each task that edits files and passes is committed there on its own; its reviewer is shown the real diff, measured with git, not the worker's description. At delivery the folder goes back to the branch it was on, unchanged, and the delivery says how to look at the work (git log) and take it (git merge). Nothing is ever pushed, merged, reset or deleted for you, and your commit hooks run. A folder with uncommitted changes gets no branch, so your own unfinished work never ends up in a run's commit; the run says so and works as before. Untick *Work on a git branch* to skip it. Tasks that edit files take turns in the folder, so each one's changes are its own.

**🤖 The Orchestrator** (panel on the Tasks page, and the Board page) is the quick path for a text deliverable — hand it one goal and it runs the whole show in one go:

1. **Plan** — Claude decomposes the goal into ≤5 self-contained subtasks
2. **Dispatch** — each subtask goes to **Auto**, which routes to the cheapest capable model (your token-conservation layer). Or **pin workers**: pick up to 4 agents in the launcher (e.g. Hermes for research, Llama for free drafts) and subtasks are distributed among them round-robin — the review/rework gate stays either way
3. **Review** — Claude judges every output against the goal
4. **Rework** — weak work goes back with specific feedback (max 2 retries per subtask)
5. **Assemble** — Claude merges everything into one polished deliverable

The goal appears on your kanban board (🤖-prefixed, In Progress → Done; failures return to Pending for your eyes), the full run archives to the vault (visible in Library and the Graph), and completion pings your Telegram. Two orchestrations can run at once. Watch live progress in the panel: each subtask shows its status, which model Auto picked, and the attempt count.

**⚠ Needs Attention** (panel on the Overview) is the one place that answers "is anything blocked on me?" — it aggregates: **approvals waiting** (with age), **failed missions** (last 24h), **missions running suspiciously long** (>10 min), and **schedules whose last run failed**. Empty = all clear. And if an approval sits unanswered for 10+ minutes, you get a one-time ⏳ Telegram reminder — so nothing waits on you silently while you're away from the dashboard.`,
  },
  {
    id: "approvals",
    title: "Approvals (The Autonomy Gate)",
    keywords: "approval gate approve reject pending card telegram mission request autonomy vault shared queue multi-machine cluster master gateway",
    body: `When an agent requests a mission (via verb or tool), it doesn't run — it becomes a **pending approval**:

1. An amber card appears at the top of every dashboard page → **Approve** / **Reject**
2. Simultaneously, a 🚦 notification lands in your **Telegram** — reply \`approve <id>\` or \`reject <id>\` from anywhere

Both paths stay in sync; approvals are idempotent (a double-tap can't launch two missions). Approving launches a single-agent Claude mission with the requested task. Cheap reversible verbs (remember/goal/journal) skip the gate.

**The queue is shared across machines.** Approvals live in the vault (\`Agentic OS/Approvals.json\`), not in per-machine \`data/\` — so *any* machine can raise one and *any* machine can answer it. That matters because OpenClaw's Telegram gateway curls its **own** \`127.0.0.1:3000\`: when the queue was machine-local, an approval raised by a schedule on the cluster master simply couldn't be answered from your phone if the gateway ran elsewhere. It sat pending. Now the gateway can live wherever you like, independent of who holds the master lease.

**Who actually runs it:** resolving only *marks* the approval. The **master** launches the mission on its next tick (or immediately, if you approved on the master), so the work always lands where the fleet's other background duties run — not on whichever laptop happened to answer Telegram. Approvals older than an hour are never auto-launched, so a restored backup or hand-edited vault file can't resurrect months of old missions.`,
  },
  {
    id: "memory-rag",
    title: "Shared Memory & Retrieval (RAG)",
    keywords: "memory shared remember facts retrieval rag search vault semantic embeddings hybrid bm25 context injection",
    body: `**Shared memory** (\`Agentic OS/Memory.md\`) is the communal brain — every agent reads relevant facts before answering, and any agent can add facts. View, edit, or dictate on the Memory page; it's also a normal Obsidian note.

**How context injection works:** for each message, the OS retrieves the ~8 most relevant memory facts **plus the top passages from your entire vault** (journals, chat logs, missions, your own notes) and injects them. When a retrieved passage contains \`[[wikilinks]]\`, the linked notes ride along too — the graph's edges feed the agents.

**Agent Rules** (\`Agentic OS/Rules.md\`) — the one note every agent is given on **every call**, whichever agent it is and whichever machine it runs on: when to log to the journal, when to save a decision, what never to store. **To change how all your agents behave, edit this note** in Obsidian (or any editor). No restart and no rebuild: the next message uses it, on every machine, as soon as OneDrive has delivered the edit. Keep it under a page — it is sent whole and only the first 2,400 characters go out; the title, tag line and quoted intro are not sent. If the note is missing or empty the built-in rules are used, and the master re-creates the note. \`/api/vault/rules\` shows exactly what agents are receiving right now and whether it came from your note. The tag *syntax* (\`<remember>\`, \`<journal>\`…) stays in code because the dashboard parses it; the note decides *when* agents use it. If OneDrive ever leaves a \`Rules-<PC>.md\` copy, merge it by hand — it is never deleted for you, because it may hold an edit.

**What the search covers** — the index is budgeted **per folder, newest notes first**, so no folder can crowd out the rest: Sessions up to 2,000 passages (the opening and the end of each conversation), Tool Memory 1,200, Missions 800 (the *end* of each log — the result, not the prompt), History 700, and every other folder (Weekly, Journal, Chats, Agents, the Guide, your own notes) its own share. \`Agentic OS/Archive\` is not searched; the weekly notes stand in for it. Before this, the index filled in folder order up to one global cap, and once session conversations grew past it, Missions, Journal, History, Chats and Agents were silently never searched. \`/api/vault/rollup\` (GET) lists how many passages each folder has in the index right now.

**Semantic upgrade (optional):** add an OpenAI-compatible embeddings endpoint to \`.env.local\`:
\`\`\`
EMBED_BASE_URL=…/v1
EMBED_API_KEY=…
EMBED_MODEL=…
\`\`\`
and retrieval becomes hybrid keyword + meaning, with vectors cached on disk and silent fallback if the endpoint fails.

**Memory vs the User Profile** — two different things, kept apart on purpose. Memory facts are discrete and *retrieved by relevance* (top ~8 for the current message). The [User Profile](#user-profile) is a single coherent note injected **whole, on every call**. Putting profile prose into the fact list would let it crowd out the specific fact a question actually needed.`,
  },
  {
    id: "user-profile",
    title: "User Profile — who the fleet thinks you are",
    keywords: "user profile personalization personalisation who you are working with honcho mem0 memory provider weekly refresh distil preferences avoid injected every agent settings panel",
    body: `Settings → **User Profile**. A maintained "who you are working with" note that is injected into **every** agent's prompt — Claude, Talos, Hermes, Codex, Auto, and every LLM you've added.

It is distilled from four sources: **shared memory · your chats · goals · tasks · journal**. Shared memory is treated as *authoritative* — where a curated fact contradicts an older chat message, the fact wins. That matters because raw chat logs preserve statements you later corrected, and without it the profile keeps resurrecting them.

**Four sections:** How you work · Current focus · Preferences & conventions · Avoid.

**How it behaves**
- **Rewritten, not appended.** Each refresh merges: keeps what still holds, revises what changed, deletes what the evidence now contradicts. (\`Agentic OS/Memory.md\` is the opposite — append-only.)
- **Refreshes weekly**, on the cluster master only, so in a machine group exactly one node rewrites the shared note. **Refresh now** in the panel forces it.
- **Capped at 1500 characters**, because it rides on every single call. If the writer overruns it is asked to compress before anything is cut.
- **Evidence or omission.** It's told never to infer personality or mood, and to write "not enough signal yet" rather than pad. A short honest profile beats a padded one — a wrong line here becomes a lie every agent repeats.

**Correcting it** — edit \`Agentic OS/User Profile.md\` by hand. The next refresh is *given* your version and told to merge it, so corrections stick rather than being overwritten. If a wrong belief came from a stale memory fact, fix that in Memory.md instead and it will propagate on the next refresh.

**Why not Honcho / mem0?** Hermes can plug into external memory providers (\`hermes memory setup\`), and they're more sophisticated — dialectic reasoning, per-agent isolation. But they are *Hermes* providers: the rest of your fleet can't see them, which fragments the one-shared-brain design. They also bill an LLM call every couple of turns. This trades that depth for fleet-wide reach at $0 on your existing subscription.`,
  },
  {
    id: "knowledge-graph",
    title: "The Knowledge Graph (in-app & Obsidian)",
    keywords: "obsidian vault graph knowledge map wikilinks backlinks home agent hub pages notes librarian nodes edges orphans hubs force visualization",
    body: `Everything the OS writes lands in your vault under **Agentic OS/** as linked markdown:

- **Home.md** — daily-regenerated map of content linking memory, goals, the task board, today's journal/chats, and every agent
- **Agents/<Name>.md** — one hub page per agent; every chat log heading, memory fact, mission result, and journal entry wikilinks back to its author
- **Chats/** (one file per day) · **Missions/** (one per mission) · **Journal/** · **Goals.md** · **Tasks.md** · **Memory.md** · **Rules.md** (what every agent must follow)
- **Weekly/** — one roll-up note per finished week (\`2026-W47.md\`): the Vault Librarian's synthesis if it ran, the facts saved to memory, the journal, one line per mission (failures called out), the machine summaries and a chat count. Built from the files themselves, with no agent call, so it can't fail on a signed-out CLI. The master writes it within a few hours of the week ending, and fills in any earlier week that has material but no note.
- **Archive/** — mission logs and daily machine summaries older than 30 days move here (\`Archive/Missions/2026-07/…\`), and **only after** the roll-up note for their week exists. Nothing is deleted: Obsidian and the Library still show them, and the weekly notes link to them by name. Agents don't search Archive — they search the weekly notes. Journal, Chats and Sessions stay where they are (app pages read them in place). \`/api/vault/rollup\`: GET previews the next pass, POST runs one now.

**🕸 Graph (/graph)** — the built-in visualization (it and the Library hold the 3,000 most recently changed notes; past that, the stat says \"newest N of M\" and the oldest notes are left out of the picture, never out of search): every vault note is a node, every resolved \`[[wikilink]]\` an edge, laid out live by a force simulation. Node size = connection count, color = folder (legend chips filter to one folder), hover highlights a note's neighborhood, **scroll zooms, drag pans or moves nodes, click opens the note in Obsidian**. The stat row counts notes, links, **orphans** (unlinked notes — feed them to the Librarian), and the top hub. Refresh re-reads the vault.

Obsidian's own graph view works too (filter \`path:"Agentic OS"\`), and any agent page's **backlinks pane** is a complete dossier of that agent's activity. The Vault Librarian weaves a synthesis note through the graph every Sunday.`,
  },
  {
    id: "goals-journal",
    title: "Goals, Journal & Workspaces",
    keywords: "goals checkbox tasks journal daily workspace switch default work progress dial",
    body: `**Goals** — checkbox tasks with a progress dial, synced two-way with \`Goals.md\` (check things off in Obsidian or here; your extra notes in the file are preserved). Agents can add goals via verb or tool.

**Journal** — one file per day, autosaving as you type, with a day switcher, word counts, and voice dictation. Agents append timestamped, attributed entries. The **Writing Rhythm** panel is a 12-week heatmap of your writing (click any filled day to open that entry), and Entry Stats tracks your **streak** — consecutive days written, and a not-yet-written *today* doesn't break it.

**Workspaces** — create them in Settings (e.g. Work, CommunityForce); the dropdown on Goals/Journal switches context. Each workspace keeps its own \`Goals.md\` + \`Journal/\` under \`Agentic OS/Workspaces/<name>/\`. Agent goal/journal verbs target your **active** workspace.`,
  },
  {
    id: "arena-analytics-evals",
    title: "Arena, Analytics & Evals",
    keywords: "arena battle crown leaderboard win rate analytics cost spend tokens latency ledger evals test cases judge scores report card",
    body: `The measurement suite:

**⚔ Arena** — same prompt to 2–4 models side by side; crown the winner. A **VS strip** shows the fighters (avatars pulse while they think), the leaderboard opens with a gold/silver/bronze **podium** for the top three, and crowning a winner fires confetti. The leaderboard's win-rates feed the Auto router's choices.

Field lessons from real battles (2026-07):
- **Crown easy battles too.** Hard battles teach the router who the champion is (Claude); *easy* battles — summaries, rewrites, short explainers — are where cheap models earn wins, and that's the evidence the "simple" tier needs to route cheaply with confidence. Leave Claude out of easy battles so the budget fighters compete on winnable ground.
- **One battle at a time when local/CLI fighters are involved.** Launching several battles at once means several simultaneous runs per agent — cloud APIs shrug, but CPU-bound Ollama models and one-shot CLIs (Hermes) choke and error. Sequential battles give fair results.
- **Reruns aren't independent.** Finished battles archive to the vault, so a rerun of a similar prompt lets fighters *retrieve earlier answers via RAG* — a small model can echo a rival's archived answer nearly verbatim. Judge with that in mind.
- **A no-show isn't a loss.** If a fighter errors, exclude it from the recorded vote rather than counting a phantom defeat.

**📊 Analytics** — every run (chats, missions, schedules) is recorded with cost, tokens, latency, and outcome. 30-day figures, runs/day, and per-agent breakdowns, with 14-day trend sparklines.

**Read the money numbers carefully — they're two different things:**
- **API spend** = agents billed per token against an API key (e.g. DeepSeek, or OpenClaw when it's pointed at a Gemini key). These are **real charges**, and only these feed the month-end projection.
- **Subscription** = agents running on a plan login (Claude via \`/login\`, Codex via ChatGPT, Hermes via Nous Portal). The Claude CLI still reports a cost figure, but it's an **estimate at API list prices, not a bill** — the real constraint is your plan's usage allowance, so heavy runs hit **rate limits** rather than an invoice. Analytics shows these separately with a violet "not billed" banner, and each agent row is tagged **BILLED / SUBSCRIPTION / FREE**.
- **Free** = local models (Ollama). No cost, no limit but your CPU.

**✓ Evals** — a saved test suite (reasoning trap, instruction-following, concision — add your own cases with scoring criteria). Run it against any agents; a Claude judge scores 0–10 per case. The history panel turns model quality into a trend line. Costs roughly one Claude run per answer judged.`,
  },
  {
    id: "reports",
    title: "Reports (Exportable Intelligence)",
    keywords: "reports export markdown html pdf print vault executive brief fleet performance cost spend reliability uptime model mix conversation insights topics brain health memory import writing missions arena evals productivity pipeline content seo",
    body: `**Reports (/reports)** turns everything the OS records into 18 one-click reports, grouped four ways:

- **Operations** — Executive Brief (the whole OS on one page) · Fleet Performance · Cost & Spend (with the month-end projection) · Reliability & Uptime · Model Mix (premium vs. local split) · Automations (schedules & watchers health)
- **The Brain** — Conversation Insights · Topic Landscape (what you actually talk about) · Brain Health (vault notes, links, orphans, hubs) · Memory & Facts · Import Coverage (how much of your history is distilled) · Writing Rhythm
- **Quality** — Mission Operations · Arena Standings · Eval Report Card
- **Output** — Productivity (tasks/goals/orchestrations) · Pipeline Flow · Content & SEO

Every report is built fresh from the live data stores when you open it (↻ re-runs it), and every one **exports three ways**:
- **↓ Markdown** — a clean .md file with KPI table, text-bar charts, and data tables.
- **↓ HTML** — a self-contained printable page; open it and print → PDF for sharing.
- **⊕ Save to vault** — lands in \`Agentic OS/Reports/\` as a dated note, so it syncs to every machine, shows up in the Library, and your agents can cite it via RAG.

A good habit: save the **Executive Brief** to the vault weekly (or wire a schedule to remind you) — it becomes a dated operational log of the whole system.`,
  },
  {
    id: "playbook",
    title: "Playbook — Worked Examples",
    keywords: "playbook recipes examples use cases how to workflow routine cookbook weekly status second opinion debate decision watcher summarizer train auto offline free brain memory routine ideas",
    body: `Copy-paste starting points. Each one names the exact page, settings, and prompt — adapt freely.

**1. Weekly project status to your phone**
*Missions → On a schedule.* Strategy **single** · agent **Claude** · **weekly**, Monday 08:30 · deliver **Telegram**.
> "You are the Monday-morning status reporter for my <project> (one line of context about it). Today is {{today}}. Review the recent vault notes below, especially <workspace folder>, plus goals and journal. Write: 1) where the project stands, 2) top 3 priorities this week, 3) risks/blockers. Under 200 words, plain text.\\n\\n{{recent_notes}}"
Why it works: \`{{recent_notes}}\` injects the week's vault activity, so the report reflects what actually happened — no manual roundup.

**2. Weekly knowledge synthesis (the Librarian pattern)**
Same as #1 but deliver **vault**: ask for a "Weekly Synthesis" note — key themes, connections between notes as \`[[wikilinks]]\`, open threads. The note becomes a knowledge-graph hub that future RAG retrievals follow.

**3. Second opinion on anything important (MoA)**
*Missions → New mission.* Strategy **MoA** · agents **Claude + DeepSeek + Llama** · synthesizer **Claude**.
> "Draft a reply to this email declining the vendor renewal but keeping the door open: <paste>"
Each model answers blind; the synthesizer merges the best parts. Use when one model's take isn't enough: important emails, plans, tricky explanations.

**4. Decide with a debate**
*Missions → New mission.* Strategy **debate** · two agents argue (2 rounds) · judge a third.
> "Should I migrate <app> from local hosting to a cloud host? Argue from cost, reliability, and maintenance burden."
The judge's verdict cites the strongest arguments — better than asking one model "what should I do?" because the positions get stress-tested.

**5. File-drop summarizer (watcher)**
*Missions → Watchers.* Trigger **file** on a folder you drop exports/notes into · prompt:
> "A new file appeared: {{event}}. Read it, summarize the 5 key points, save anything worth remembering to shared memory, and flag action items."
Results ping Telegram. First check baselines silently; the cooldown stops spam if you drop ten files at once.

**6. Train Auto with arena fights**
*Arena.* Pick a task you do often (code review, rewriting, planning) → battle 2–4 models on a *real* example → **crown the winner**. Do this a handful of times and Auto's "hard" tier starts routing to your actual champion instead of a guess. Then run **easy-tier battles without Claude** (summaries, rewrites, explainers, one battle at a time) so the cheap models can win crowns — that's what teaches the "simple" tier to route cheaply. Check /analytics to see if the cheap models are earning their spot.

**7. $0 days (local Llama)**
For drafts, summaries, quick questions: chat with **Llama** directly — free, private, offline, and it can still search your vault and file goals (tool-capable). Auto's "simple" tier already prefers cheap models; crowning Llama in easy arena fights pushes more traffic there.

**8. Build the shared brain deliberately**
End a work session by telling any agent: "Remember: <the three facts worth keeping>. Add a goal: <next step>. Journal: <one-line summary>." Every agent — including Talos on your phone — recalls it afterwards. The brain compounds: the more you save, the sharper every schedule, mission, and RAG answer gets.`,
  },
  {
    id: "settings-env",
    title: "Settings & Environment Reference",
    keywords: "settings env environment variables configuration mcp command agents workspaces vault_dir telegram_target embed openclaw hermes bin cmd",
    body: `**Settings page**: LLM connections · **User Profile** (who the fleet thinks you are — see its own section) · **API Keys** for creative providers (OpenAI/ElevenLabs/Replicate) · **Publishing** targets · custom command agents (any local CLI becomes an agent — \`{input}\` placeholder or stdin) · MCP servers for the Claude bridge · workspaces · **Machine Group & Roles**.

**Where keys live** — LLM keys sit in \`data/registry.json\`; creative-provider keys in \`data/services.json\`. Both are entered in the UI and never leave this machine (both git-ignored). Any key can instead be set as an \`.env.local\` variable, which the app uses as a fallback.

**A green orb on an LLM row means "ready", which is not the same as "keyed"** — a localhost endpoint (Ollama) needs no key and shows **amber + KEYLESS** so you can tell the two apart at a glance. Open the pencil to be certain: the key field reads \`unchanged\` when one is stored and \`no key set\` when it isn't.

Other per-machine state in \`data/\` (all git-ignored, none of it syncs): \`cluster.json\` (this machine's group role), \`user-profile.json\` (profile refresh timestamp), \`schedules.json\`, \`approvals.json\`, \`llm-import.json\`.

**\`.env.local\` reference** (restart the server after changes):

| Variable | Purpose |
| --- | --- |
| \`OPENCLAW_BIN\` / \`OPENCLAW_CMD\` | OpenClaw binary/command template |
| \`HERMES_BIN\` / \`HERMES_CMD\` | Hermes binary/command template |
| \`TELEGRAM_TARGET\` | Telegram recipient id (defaults to your account) |
| \`TELEGRAM_BOT_TOKEN\` | **Set this on every machine that can become cluster master.** Sends via the Bot API directly instead of spawning \`openclaw\`. Without it, a master that lacks OpenClaw silently drops every scheduled notification |
| \`EMBED_BASE_URL/API_KEY/MODEL\` | activates semantic retrieval |
| \`OPENAI_API_KEY\` | Studio image + voice (fallback for the Settings field) |
| \`GEMINI_API_KEY\` | Studio image via Google Gemini (fallback) |
| \`ELEVENLABS_API_KEY\` | Studio premium voices (fallback) |
| \`REPLICATE_API_TOKEN\` | Studio video (fallback) |
| \`WP_SITE\` / \`WP_USERNAME\` / \`WP_APP_PASSWORD\` | WordPress publishing target for the Content pipeline (fallback for Settings → Publishing) |
| \`GHOST_SITE\` / \`GHOST_ADMIN_API_KEY\` | Ghost publishing target (Admin API key = \`id:secret\`) |
| \`WEBFLOW_TOKEN\` / \`WEBFLOW_COLLECTION_ID\` / \`WEBFLOW_BODY_FIELD\` | Webflow CMS publishing target |
| \`LLM_EXPORTS_DIR\` | folder scanned by History Import (default \`Documents\\llm-exports\`) |
| \`VAULT_DIR\` | Obsidian vault path override |
| \`MC_ALLOW_API_KEYS\` | \`1\` = let provider API keys reach the agent CLIs. Leave unset: by default Claude Code, Codex and command agents never see them and run on their subscription login (Health → Subscriptions, not API tokens) |
| \`ANTHROPIC_API_KEY\` | Claude auth by API key instead of the CLI login — billed per token, and **ignored unless \`MC_ALLOW_API_KEYS=1\`** |

**Data files** (\`data/\`, git-ignored): registry.json (LLMs + keys) · **services.json (creative API keys)** · **publish.json (WordPress connection)** · **llm-import.json (history scan index)** · **cluster.json (this machine's group role + install folder)** · missions.json · schedules.json · watchers.json · approvals.json · usage.json · evals.json · arena.json · mcp.json · embeddings-cache.json.`,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    keywords: "error fix broken offline 401 402 port conflict telegram silent hydration stale restart red orb hermes dashboard control room 9119 services daemon ollama start update other computer laptop",
    body: `**Agent shows red after PC startup** — cold-start probes can time out; they auto-retry and recover within a minute or two. No action needed.

**Hermes Control Room / dashboard not running** — the **Local Services** panel on the Hermes Lab page shows each companion daemon (Hermes dashboard on 9119, Ollama on 11434) with a **Start** button. They also start automatically when Mission Control boots (which happens at login), so a system restart brings them up. Note the dashboard is launched with \`--skip-build --no-open\` — the plain \`hermes dashboard\` rebuilds its web UI first and can hang in the background.

**Control Room says "Hermes isn't installed" / the Hermes agent is red** — the app never scans the disk; it trusts \`HERMES_BIN\` in *this machine's* \`.env.local\`. Two traps: (1) the path must use **this machine's** Windows username (\`echo $env:USERNAME\`) — a \`.env.local\` copied from another machine is the single commonest cause, and the agent page now says so explicitly when it detects a path naming a different user; (2) env is read only at boot, so **restart the server** after editing.

**The dashboard (port 9119) repairs itself now.** The supervisor starts it with \`--skip-build\` for a ~4s launch, which assumes the web UI has been built at least once. If the port doesn't open, the supervisor automatically retries **without** \`--skip-build\` — a real build that takes a few minutes but only happens once. The Local Services panel shows "building its web UI" while that runs. If it still won't come up, \`data/hermes-dashboard.log\` in the repo has the daemon's own output.

**Updating another computer to the latest version** — double-click **\`update.cmd\`** in the repo on that machine (\`git pull\` → \`npm install\` → \`npm run build\` → restart). Then re-enter that machine's per-machine secrets in Settings (Studio API keys, WordPress connection) — they never sync.

**Server won't auto-start, or dies when I close the terminal** — it was only ever started by hand in a terminal (closing the window kills the child process). Fix: run **\`install-service.cmd\`** in the repo once. It registers the "Mission Control Watchdog" Scheduled Task, which starts the server hidden and detached (no window to close) at every login and every 5 minutes if it isn't running. Stop it with \`stop.cmd\`.

**Reports say there are two masters, or the vault's Bridge folder fills with \`Status-<PC>-2.md\` copies** — a machine that shares the vault but never joined the machine group used to act as a lone master: it ran its own schedules and rewrote \`Status.md\` alongside the real master, and OneDrive kept both versions as conflict copies. Now such a machine holds back while the group has a live master, and its Health shows "Machine group: … hasn't joined it". Fix it there: **Settings → Machine Group & Roles → Enable machine-group coordination**, role *Workstation*, Save (or installer → Modify → 1). The master deletes leftover conflict copies of everything it generates by itself (they go to the OneDrive recycle bin): \`Status-*.md\`, \`lease-*.json\`, duplicate machine heartbeats, \`Home-<PC>.md\` and \`Guide-<PC>.md\`, and the \`-<PC>\` copies of daily machine summaries, weekly notes and mission logs. It no longer rewrites Home and Guide when nothing changed, which is what produced most of them. Copies of notes that you or an agent wrote — Memory, Goals, Tasks, Rules, Journal — are never deleted automatically, because a copy may be the only place an edit survives.

**"Windows Script Host: An Application Control policy has blocked this file" (Mission Control Server.vbs)** — Smart App Control (or a company App Control policy) blocks .vbs files, and older installs started the server with a .vbs launcher in the Startup folder. Run \`update.cmd\`, then **\`install-service.cmd\`** (or the installer → Modify → auto-start): it switches to the Scheduled Task, which uses no .vbs, and deletes the old launcher.

**Auto-start points at the wrong folder** — re-run **\`install-service.cmd\`**; it re-registers the task from scratch and starts the server. It normally targets the folder it lives in, but since every machine keeps the repo somewhere different you can name the folder explicitly: \`install-service.cmd "D:\\code\\my-mission-control"\`. If that folder has no \`server.cmd\`, it asks you to type the right path rather than registering a task that points nowhere.

**The server died mid-session and nothing brought it back** — run **\`install-watchdog.cmd\`** in the repo once: it registers the "Mission Control Watchdog" Scheduled Task that starts the server at login and checks port 3000 every 5 minutes and relaunches \`server.cmd\` (hidden) if nothing is listening — confirming the server actually answers, not launching blind. It stands down while \`data\\watchdog.pause\` exists (auto-expires after 2 h) or while a \`next build\`/\`next dev\` is running, and it never kills a hung server (in-flight runs die with the process — that is a human call). Actions and warnings go to \`data\\watchdog.log\`; \`install-watchdog.cmd status\` shows the task and log tail, \`install-watchdog.cmd uninstall\` removes it. Install it on every machine that can become master.

**Claude fails with 401** — the CLI login expired. Run \`claude\` in a terminal and \`/login\` once.

**API LLM errors** — 401 bad key · 402 no credit (top up with the provider) · a model failing repeatedly is skipped by Auto until it succeeds again.

**Telegram bot silent** — \`openclaw gateway status\` in a terminal; \`openclaw gateway start\` if stopped.

**Port 3000 in use / changes not visible** — run \`stop.cmd\`, then the desktop shortcut. After code edits, \`npm run build\` first (the background server serves the production build).

**Where everything lives** — code: \`Documents/mission-control\` (git → github.com/igrant9679/AIOSGV75) · notes: your vault's \`Agentic OS/\` folder · state: \`data/\` in the project.`,
  },
];

/** Full guide as one markdown document (vault export), in this network's product name. */
export function guideMarkdown(product = "Mission Control"): string {
  const b = (t: string) => (product === "Mission Control" ? t : t.split("Mission Control").join(product));
  return [
    `# ${product} — User Guide`,
    ``,
    `#agentic-os/guide · This note is auto-generated daily from the in-app guide (/guide). Part of [[Agentic OS/Home|Agentic OS]].`,
    ``,
    ...GUIDE_SECTIONS.map((s) => b(`## ${s.title}\n\n${s.body}\n`)),
  ].join("\n");
}
