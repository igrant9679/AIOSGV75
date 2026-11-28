/**
 * The Help panel (components/HelpDrawer.tsx): plain-language help for someone
 * who has never used the app. The full reference manual stays in
 * lib/guideContent.ts (/guide); this file is the front door to it.
 *
 * Client-safe: plain data, no Node imports. Written as "Mission Control"; the
 * panel swaps in this network's product name.
 *
 * When you add or change a page, give it an entry in PAGE_HELP (and update the
 * guide — AGENTS.md rule 5).
 */

export interface PageHelp {
  /** one sentence: what this page is */
  what: string;
  /** when you would come here */
  useFor: string[];
  /** how to do the main thing(s), in order */
  steps?: { title: string; items: string[] }[];
  tips?: string[];
  /** ids of sections in lib/guideContent.ts that go deeper */
  guide?: string[];
}

export const HELP_INTRO = `**Mission Control is one control panel for all your AI tools.** Claude, ChatGPT's Codex, Hermes, local models and any AI you add with a key all work from here, on this computer and on your other computers.

Underneath is a shared **brain**: a folder of notes (your Obsidian vault, synced by OneDrive) that every AI reads before it answers and writes to as it works. That is why an AI you talk to today knows what another one did yesterday, on another machine.

You don't need to learn every page. Most days you use four or five of them.`;

/** The handful of things most people actually do, in the order worth learning them. */
export const START_HERE: { title: string; body: string; href: string; cta: string }[] = [
  {
    title: "1. Check what needs you",
    body: "The Command page is the home screen: anything waiting for your answer, what is running now, what finished today, and a health check that tells you if something has quietly stopped working (and how to fix it).",
    href: "/command",
    cta: "Open Command",
  },
  {
    title: "2. Ask an AI something",
    body: "Open **Auto** and type, the way you would in ChatGPT. Auto picks the cheapest AI that can do the job well and tells you who answered. Want a specific one? Open **Claude**, **Hermes** or any agent in the sidebar.",
    href: "/auto",
    cta: "Chat with Auto",
  },
  {
    title: "3. Hand over a whole project",
    body: "On **Runs**, describe a bigger job in plain words. It is broken into tasks, you approve the plan, and real AI sessions do the work, check each other and hand you a finished delivery. Cheap or free models do the easy parts; Claude does the hard ones.",
    href: "/runs",
    cta: "Start a run",
  },
  {
    title: "4. Pick up where you left off",
    body: "**Projects** lists every Claude Code, Codex and Hermes session from every computer, grouped by project. Click one to read the whole conversation and reply to it right there.",
    href: "/projects",
    cta: "Open Projects",
  },
  {
    title: "5. Make something happen on its own",
    body: "On **Missions**, switch the launcher to **On a schedule** to run a prompt every morning, weekday or week (a Monday status report to your phone, say). The **Schedule** page shows everything that will run and when.",
    href: "/missions",
    cta: "Open Missions",
  },
  {
    title: "6. See your computers",
    body: "**Fleet** shows each computer, its AI subscriptions and how much of them is used, and whether the computers can reach each other.",
    href: "/fleet",
    cta: "Open Fleet",
  },
];

/** "I want to… → use this page". Several pages overlap; this is the honest chooser. */
export const WHICH_PAGE: { want: string; page: string; href: string; why: string }[] = [
  { want: "Ask one question, get one answer", page: "Auto (or any agent's page)", href: "/auto", why: "A normal chat. Auto chooses the AI; an agent's own page talks to just that one." },
  { want: "Have several AIs answer the same question", page: "Missions → Mixture of Agents or Debate", href: "/missions", why: "Each AI answers on its own and the best is merged, or two argue and a third judges." },
  { want: "Talk it through with several AIs in one room", page: "Mastermind", href: "/mastermind", why: "A group chat: they reply in turn and react to each other." },
  { want: "Get a project done: plan, work, check, deliver", page: "Runs", href: "/runs", why: "Real sessions in a folder, able to edit files if you allow it; you approve the plan; tasks are checked and retried." },
  { want: "Get one written deliverable from a goal, quickly", page: "Board (or the Orchestrator on Tasks)", href: "/board", why: "Plans, writes, reviews and assembles text in one go. No folder, no file edits." },
  { want: "Turn a rough idea into something, with one approval", page: "Pipeline", href: "/pipeline", why: "Drop the idea; small things get filed, projects wait for your Approve and are then built." },
  { want: "Run something every day/week", page: "Missions → On a schedule", href: "/missions", why: "Then see and pause it on Schedule." },
  { want: "React when something happens (a file appears, a goal is done)", page: "Missions → Watchers", href: "/missions", why: "A watcher starts a mission when its trigger fires." },
  { want: "Continue a Claude Code / Codex session", page: "Projects", href: "/projects", why: "Every session from every computer; reply in place." },
  { want: "Find something I discussed before", page: "Conversations", href: "/conversations", why: "Searches every chat with every agent, on every computer." },
  { want: "Keep a to-do list", page: "Tasks (or Goals)", href: "/tasks", why: "Tasks is a kanban board; Goals is a checklist per workspace. Both are notes in your vault." },
  { want: "Tell every AI something to remember", page: "Memory", href: "/memory", why: "Facts here are read by every agent before it answers." },
];

export const GLOSSARY: { term: string; def: string }[] = [
  { term: "Agent", def: "An AI you can talk to from the sidebar: Claude, OpenClaw (Talos), Hermes, Codex, a local model, or any AI you added with a key. Each has its own chat page." },
  { term: "Auto", def: "Not an AI itself: a router. You talk to Auto and it picks a real agent for each message, cheapest first, using what it has learned from Arena battles and how reliable each agent has been." },
  { term: "Session", def: "One conversation in Claude Code, Codex or Hermes, wherever you started it (terminal, desktop app, IDE or Mission Control). Sessions live on the computer that ran them; Projects shows all of them." },
  { term: "Mission", def: "A task sent to one or more agents in the background: one agent, several in parallel (Mixture of Agents), a debate, or a pipeline. Results are saved to the vault." },
  { term: "Run", def: "A project handed to Runs: planned into tasks, done by real sessions, checked, retried and delivered. Survives restarts." },
  { term: "Tier", def: "How hard a run task is. Routine work goes to free or cheap models, standard work to Codex, hard work to Claude. A task that keeps failing moves up a tier." },
  { term: "Vault", def: "The folder of Markdown notes (an Obsidian vault, synced by OneDrive) that is Mission Control's brain. The app writes under Agentic OS/ in it. You can open and edit it in Obsidian." },
  { term: "Shared memory", def: "Agentic OS/Memory.md: short facts every agent is given when they matter. Add to it on the Memory page, or tell any agent \"remember …\"." },
  { term: "Rules note", def: "Agentic OS/Rules.md: instructions given to every agent on every call. Edit it to change how all your agents behave." },
  { term: "User profile", def: "A short note about you that every agent receives, refreshed weekly from your memory, chats, goals and journal. Settings → User Profile." },
  { term: "Approval", def: "A pause for your yes/no. When an agent asks to start a mission, or a run's plan is ready, an amber card appears on every page (and on Telegram if set up)." },
  { term: "Machine group", def: "All your computers running Mission Control on the same vault. They share the brain, sessions and approvals. One is the master." },
  { term: "Master", def: "The one computer in the group that runs schedules, watchers and other background duties, so they don't run twice. If it goes offline, a backup takes over." },
  { term: "Workstation / Backup / Primary", def: "Roles in the machine group. Primary is the preferred master; Backup takes over when it's down; a Workstation shares and works but never runs scheduled jobs." },
  { term: "LAN / Off-LAN", def: "Computers on the same home network talk directly (seconds). Others talk through OneDrive (1-2 minutes). Both work; LAN is just faster. Fleet → Network." },
  { term: "Subscription vs API key", def: "Claude, Codex and Hermes run on your paid plans (a flat monthly fee with usage limits). An AI added with an API key is billed per use. Mission Control keeps API keys away from the subscription tools so they can't switch to per-use billing by accident." },
  { term: "Local model", def: "An AI that runs on your own computer through Ollama (gpt-oss:20b here). Free and private, slower and less capable than the big ones. It can read the shared brain but never writes to it." },
  { term: "Check (in Runs)", def: "A command this computer may run to prove a task works, such as running the tests. You list them per project folder; a task only passes if its checks pass." },
  { term: "Watcher", def: "A rule that starts a mission when something happens: a new file in a folder, a goal checked off, or a matching memory." },
  { term: "Schedule", def: "A mission that runs by itself hourly, daily, on weekdays or weekly, optionally sending the result to Telegram." },
  { term: "Workspace", def: "A separate set of goals and journal (Work, a client, …). Switch with the dropdown on Goals or Journal; create them in Settings." },
  { term: "OS verbs", def: "Tags an agent can put in a chat reply to act: save a memory, add a goal, write to the journal, or ask for a mission (which needs your approval)." },
  { term: "Health", def: "The panel at the top of Command. It checks the things that make Mission Control quietly stop working (sign-ins, the vault, scheduled jobs, disk space) and tells you how to fix each one." },
];

/** Searchable "How do I…" answers. Short; each points at the page that does it. */
export const HOW_TO: { q: string; a: string; href?: string; guide?: string }[] = [
  { q: "Ask an AI a question", a: "Open **Auto** in the sidebar and type. Enter sends, Shift+Enter makes a new line. The line under each answer says which AI answered and why.", href: "/auto", guide: "auto" },
  { q: "Talk to one specific AI", a: "Click its name in the sidebar (Claude, Hermes, OpenClaw, or any agent you added). On Claude's page the buttons above the box set how much it may do on its own: **Safe** (default) asks nothing risky, **Full Access** can run commands on your PC.", href: "/claude", guide: "claude" },
  { q: "Give a bigger project to the AIs", a: "Go to **Runs** → write what you want in plain words → choose where it works (*Works in*: a project folder, or the home folder) → tick *Tasks may edit files there* only if they should change files → **Plan it**. Read the plan when it appears and **Approve** it. You can Pause or Stop at any time; the result lands in *Delivery*.", href: "/runs", guide: "orchestrator-attention" },
  { q: "Approve or reject something", a: "Amber cards at the top of every page are waiting for you: click **Approve** or **Reject**. The same list is under *Needs you* on Command. With Telegram set up you can reply `approve <id>` from your phone.", href: "/command", guide: "approvals" },
  { q: "See what's running and what finished", a: "**Command** shows running now, waiting on you, done today, and live sessions on every computer with their current step. **Timeline** is the full history of every AI action.", href: "/command", guide: "second-brain" },
  { q: "Continue a Claude Code or Codex session from here", a: "Open **Projects**, pick the project, click the session. The whole conversation opens; type in the box under it to reply. *Answer only* is safe; *Can edit files* lets it change files. Sessions on other computers need that computer's *Replies from my other machines* switched on (Fleet → Sharing).", href: "/projects", guide: "second-brain" },
  { q: "Start a new session in a project", a: "**Projects** → open the project → **+ New session**, choose Claude Code, Codex or Hermes, type the first message.", href: "/projects" },
  { q: "Run something every morning (or week)", a: "**Missions** → switch the launcher to **On a schedule** → pick the agent, how often and the time, and where the result goes (Telegram or just the vault) → save. Pause, rename or run it now from **Schedule**. Schedules run on the master computer, so create them there.", href: "/missions", guide: "schedules" },
  { q: "Get several AIs' opinions on one question", a: "**Missions** → New mission → strategy **Mixture of Agents** (all answer, the best is merged) or **Debate** (two argue, a third judges) → tick the agents → Launch. You can close the tab; it keeps going.", href: "/missions", guide: "missions" },
  { q: "Make every AI remember something", a: "Open **Memory** and add the fact, or just tell any agent in chat: \"Remember that …\". Every agent reads relevant facts before answering, on every computer.", href: "/memory", guide: "memory-rag" },
  { q: "Change how all my AIs behave", a: "Edit the note **Agentic OS/Rules.md** in your vault (in Obsidian or any editor). Every agent gets it on every call, starting with the next message. Keep it under a page.", guide: "memory-rag" },
  { q: "Find something I discussed before", a: "**Conversations** searches every chat with every agent on every computer. Type a word; filter by agent or computer; expand a result to read it, or open it in Obsidian.", href: "/conversations", guide: "conversations" },
  { q: "Add an AI with an API key (Grok, Gemini, DeepSeek…)", a: "**Settings → LLM Connections** → pick the provider → paste the key → save. It appears in the sidebar. It's billed by that provider per use, so Auto won't use it unless you opt it in on the Auto page.", href: "/settings", guide: "api-llms" },
  { q: "Use the free local model", a: "If the installer pulled it, it's already in the sidebar as *Local (gpt-oss 20b)*. Chat with it like any agent. It's free and private but less capable; Runs also gives it the smallest text-only tasks first.", guide: "local-and-coding-agents" },
  { q: "Stop a session or run that's stuck", a: "**Command → Live sessions** flags *Stuck?* and *Looping?* sessions; click **Stop**. A run on **Runs** has its own Stop button.", href: "/command", guide: "fleet-control" },
  { q: "Answer an AI's permission prompt without going to that computer", a: "Fleet → Session alerts → *Permission prompts from the app*. Then when Claude Code asks permission, a card pops up on every page with Allow / Always allow / Deny.", href: "/fleet", guide: "remote-control" },
  { q: "Use Mission Control from my phone", a: "**Settings → Phone access**: set a PIN, switch it on, and open the address it shows on your phone (same Wi-Fi). Away from home, use Tailscale.", href: "/settings", guide: "remote-control" },
  { q: "Get results and alerts on my phone (Telegram)", a: "Telegram is how Mission Control messages your phone (scheduled reports, watcher alerts, approvals). Make a bot with Telegram's @BotFather, then put its token and your chat in **Settings → This network → Telegram**. After that, choose *Telegram* as the delivery for a schedule, or switch on Telegram alerts on Fleet → Session alerts.", href: "/settings", guide: "new-network" },
  { q: "Get alerts when a session needs me", a: "**Fleet → Session alerts**: install the hook on every machine, then turn on browser notifications and/or Telegram alerts.", href: "/fleet", guide: "fleet-control" },
  { q: "Check that my computers can talk to each other", a: "**Fleet → Network**. Green *LAN ✓* is direct. Violet *other network → via OneDrive* still works, just slower. *Test OneDrive* proves both directions. Amber is worth a look.", href: "/fleet", guide: "fleet-control" },
  { q: "Stop an MCP server loading into every Claude session (e.g. WanGP)", a: "**Fleet → Setup**: click the server on that computer's card and confirm. Your own servers are turned off with their settings kept, so turning them back on restores them; one that comes with a plugin is turned off with its plugin. New Claude sessions get the change.", href: "/fleet", guide: "fleet-control" },
  { q: "See how much of a Claude or ChatGPT login is used across all my computers", a: "**Fleet → Accounts**: one row per login, adding up every computer that uses it, with the limit, when it resets, and when it would fill at the current pace. If one computer hits a limit, work stops being sent to the others on that login too.", href: "/fleet", guide: "fleet-control" },
  { q: "Copy a skill to another computer", a: "**Fleet → Setup**: on the computer that lacks it, click the amber **+ skill** chip and confirm. The receiving computer must allow *Answers + file edits*. Copy only skills you trust: a skill can include scripts.", href: "/fleet", guide: "fleet-control" },
  { q: "See what my computers asked each other to do", a: "**Fleet → Remote actions**: every reply, Stop, move, permission answer, update, setup change and skill copy between computers, and whether it was done or refused. A request that names a computer with no record of sending it is flagged in rose.", href: "/fleet", guide: "fleet-control" },
  { q: "Keep a conversation going when my Claude or ChatGPT plan hits its limit", a: "Nothing to do: a reply or new session that hits its plan's limit carries on with the next ready tool (Claude Code → Codex → local model by default), with the conversation so far. Change the order on **Fleet → Agents & fallback**.", href: "/fleet", guide: "fleet-control" },
  { q: "Send a message that waits until the session is free", a: "Tick **when it's free** under the reply box. It waits until the session is closed, nothing else is running in it and its plan isn't at its limit, then continues the session itself. Cancel it from its bubble.", href: "/projects", guide: "fleet-control" },
  { q: "Use Gemini CLI (or another ACP agent) from Mission Control", a: "**Fleet → Agents & fallback** → **+ Gemini CLI**, then **Test**. Sign in yourself first (run `gemini` in a terminal). It then appears in New session, Run somewhere and Team.", href: "/fleet", guide: "fleet-control" },
  { q: "Set up a team of agents that hand work to each other", a: "**Command → Team** → **+ teammate** (name, role, tool, machine, folder). Write **@Name task** in the channel; a teammate hands on with a final line **@Other: task**.", href: "/command", guide: "fleet-control" },
  { q: "Stop all automatic work on every computer for a while", a: "**Command → Fleet pause**: 1 hour, 4 hours or until you resume. Schedules, watchers and project runs wait; what you start yourself still runs. **Resume** is on the banner at the top of every page.", href: "/command", guide: "fleet-control" },
  { q: "See which computer is short of memory", a: "**Fleet**: under each computer's name, CPU, memory and GPU. Amber or rose memory means close to running out; hover to see what is using it. Health warns too.", href: "/fleet", guide: "fleet-control" },
  { q: "Something isn't working", a: "Look at **Health** at the top of Command first: it names the problem and the fix (most often \"run claude in a terminal and type /login\"). Then see Troubleshooting in the Guide.", href: "/command", guide: "troubleshooting" },
  { q: "Update another computer to the latest version", a: "**Fleet → Versions → Update** on that computer's row. It waits until nothing is running there, then downloads the latest version, rebuilds and restarts; a version that doesn't build is undone. A computer on an older version says *run update.cmd there once*: double-click **update.cmd** in its Mission Control folder, and from then on it can be updated from here.", href: "/fleet", guide: "fleet-control" },
  { q: "Set up Mission Control on a new computer", a: "Run **MissionControlSetup.exe** (Windows) or the Mac installer command from the Guide. It installs everything, finds your vault, joins the machine group and signs in.", guide: "install" },
  { q: "Keep a to-do list", a: "**Tasks** is a board (Pending → In progress → Done; drag cards). **Goals** is a checklist per workspace. Both are notes in your vault, so they sync and you can edit them in Obsidian.", href: "/tasks", guide: "ops-pages" },
  { q: "Write in my journal", a: "**Journal** has one page per day that saves as you type; switch days at the top, or dictate with the mic.", href: "/journal", guide: "goals-journal" },
  { q: "Bring in my old ChatGPT / Claude history", a: "Export your data from ChatGPT or Claude, drop the ZIP in Documents\\llm-exports, then **Import → Scan** (free) and **Distill** (uses an AI, with a limit you set).", href: "/import", guide: "history-import" },
  { q: "Make images, voice or video", a: "**Studio** (needs an OpenAI, Gemini, ElevenLabs or Replicate key in Settings → API Keys). Results save to the vault.", href: "/studio", guide: "studio" },
  { q: "Write a blog article and publish it", a: "**Content** → type the keyword → pick a writer → it drafts an SEO article with a score. Export it, or push it as a draft to WordPress, Ghost or Webflow (connect them in Settings → Publishing).", href: "/content", guide: "content-pipeline" },
  { q: "See what my AI use costs", a: "**Analytics** splits real per-use charges (API keys) from subscription use (a flat plan; the figure shown is an estimate, not a bill) and free local use.", href: "/analytics", guide: "arena-analytics-evals" },
  { q: "Teach Auto which AI is best", a: "On **Arena**, give the same prompt to 2-4 AIs and crown the winner. Do it for easy tasks too, without Claude, so cheap models can earn the easy work.", href: "/arena", guide: "arena-analytics-evals" },
  { q: "Change how the app looks", a: "**Appearance**: theme, colours, fonts, density, sidebar. Changes apply instantly and are remembered in this browser. The sun/moon button at the top switches light and dark.", href: "/appearance", guide: "appearance" },
  { q: "Jump to a page quickly", a: "Press **Ctrl+K** and type the page or agent name. **?** shows the keyboard shortcuts, **F1** opens this Help.", guide: "the-deck" },
];

const RUN_STEPS = [
  "Write the brief in plain words: what you want, for whom, and what \"done\" looks like.",
  "Choose *Works in*: a project folder on a computer that has it, or the home folder for pure writing/research.",
  "Tick *Tasks may edit files there* only if the AIs should change files. Unticked, they only answer in text.",
  "Click **Plan it**. In a minute the plan appears: read the tasks (open one to see exactly what its worker will be told) and **Approve** it.",
  "Watch tasks move: running → checking → review → done. You can Pause, Resume or Stop.",
  "Read the result under *Delivery*. It says, per task, whether it was proven by a check or only reviewed.",
];

export const PAGE_HELP: Record<string, PageHelp> = {
  "/overview": {
    what: "The overview: your agents, this computer's vitals, what's queued, and anything blocked on you.",
    useFor: ["A quick glance at whether everything is up", "Seeing if anything needs your attention", "This computer's CPU, memory and disk"],
    tips: ["Lime means healthy, amber degraded, rose needs attention.", "Command is the more useful home screen day to day; you can make it your start page in Appearance."],
    guide: ["ops-pages", "the-deck"],
  },
  "/command": {
    what: "The home screen: what needs you, what is running, what finished, and whether anything has quietly broken.",
    useFor: ["Answering anything that waits for you", "Seeing live sessions on every computer", "Fixing problems the Health panel finds", "Running a task on whichever computer suits it best"],
    steps: [
      { title: "Read it top to bottom", items: ["**Health**: one green line means all is well. Otherwise each problem says what stops working and the fix.", "**Fleet pause**: hold every computer's autonomous work (schedules, watchers, project runs) for 1 hour, 4 hours or until you resume. A banner on every page shows it and has **Resume**.", "**Needs you**: approvals, sessions waiting for an answer, long runs that finished. Click one to open it, ✕ to dismiss.", "**Live now**: every open session, its current step and how long it has run. *Stuck?* and *Looping?* flags; **Stop** ends it.", "**Subscription meters**: how much of each plan you have used."] },
      { title: "Run somewhere", items: ["Describe a task, optionally pick a project and tool.", "Mission Control ranks the computers (online, has the folder, plan not at its limit, least busy).", "Pick one; the result appears below and as a session in the project."] },
    ],
    guide: ["second-brain", "fleet-control"],
  },
  "/timeline": {
    what: "Every AI action from every tool and computer, newest first.",
    useFor: ["\"What did my AIs do today?\"", "Finding a session by when it happened", "Seeing background runs (schedules, Mission Control's own agents)"],
    tips: ["Filter by tool, computer, project and where it was started; search box at the top.", "The Sort menu changes the order; your choice is remembered."],
    guide: ["second-brain"],
  },
  "/projects": {
    what: "All your sessions (Claude Code, Codex, Hermes, on every computer) grouped by project, which you can read and continue here.",
    useFor: ["Reopening an old conversation and replying to it", "Starting a new session in a project folder", "Searching across every session on every computer", "Moving a session to another computer"],
    steps: [
      { title: "Reply to a session", items: ["Pick a project on the left, then click a session.", "The full conversation opens, tool calls included.", "Type under it. *Answer only* (default) reads and answers; *Can edit files* may change files.", "Ctrl+Enter sends. The reply is saved in the real session, so the Claude app or terminal shows it too."] },
      { title: "Start one", items: ["Open the project → **+ New session** → choose the tool → type the first message."] },
    ],
    tips: ["✎ renames a project or session. **Group with AI** sorts the Unsorted pile into projects.", "For sessions on another computer, that computer must allow it: Fleet → Sharing → *Replies from my other machines*."],
    guide: ["second-brain", "fleet-control"],
  },
  "/fleet": {
    what: "Your computers × your AI subscriptions, plus how the computers connect and share.",
    useFor: ["Seeing each computer's sessions and plan usage", "Updating every computer to the latest version from here (Versions)", "Checking computers can reach each other (Network)", "Choosing what each computer shares", "Setting up alerts and permission prompts", "Controlling everything from Telegram through Talos (Talos panel)"],
    steps: [
      { title: "Talos (Telegram)", items: ["Ask Talos anything about the fleet; tell it what to do and reply **yes** to its confirm card.", "**Talos** panel: try a question, notifications, quiet hours, the morning digest, Telegram failover, and the changes made through Talos."] },
      { title: "The panels, top to bottom", items: ["**The grid**: one row per computer, one column per subscription (sessions, tokens, % used). Under each name: CPU, memory and GPU; memory turns amber, then rose, as it nears the point where Windows runs out (hover for the biggest programs).", "**Setup**: each computer's AI tools side by side: versions, MCP servers, plugins, skills (and which it is missing). Click an MCP server or plugin to turn it off or on there.", "**Versions**: which version each computer runs and how far behind GitHub it is. **Update** pulls, builds and restarts it there once nothing is running; **Update all** does every computer that is behind.", "**Network**: green *LAN ✓* is direct; violet *other network → via OneDrive* still works, slower; *Test OneDrive* proves both directions.", "**Sharing across machines**: what this computer shares, and whether other computers may reply to its sessions.", "**Session alerts**: the hook, notifications, Telegram, permission prompts from the app, daily summary."] },
    ],
    guide: ["fleet-control", "remote-control", "multi-machine"],
  },
  "/board": {
    what: "Give the fleet one goal; a manager (Claude) splits it up, workers write the parts, a reviewer checks them, and it is assembled into one deliverable.",
    useFor: ["A written deliverable (a plan, a report, a document) from one sentence", "When you don't need files changed"],
    tips: ["For work in a project folder, with file edits, tests and approval of the plan first, use **Runs** instead."],
    guide: ["orchestrator-attention"],
  },
  "/work": {
    what: "Every task your repositories mention (to-do lists, next steps, “waiting on you” sections, open issues, and what GitHub says needs you) on one board, each assigned to you, a Team teammate, or a machine and tool in the fleet.",
    useFor: ["Managing the work across all your apps and projects in one place", "Handing development tasks to the fleet and checking the results", "Keeping your own to-dos from every project together"],
    steps: [
      { title: "Fill it", items: ["Make a GitHub report (GitHub → Refresh); its tasks come in here by themselves, or press **Sync from GitHub**.", "**Assign for me**: Mission Control gives things only you can do (decisions, sign-ins, approvals, secrets, merges) to you, and development work to the machine or teammate that has the project's folder.", "**Smart assign**: Claude (with no tools) looks at the unclear ones."] },
      { title: "Work it", items: ["Change anyone's assignment with the picker on the card; choose *answer only* or *may edit files* for an AI.", "**Start** sends the task with its context; the card moves to *In progress*, then *Review* with the result and a link to the session.", "Mark **Done**, send it **Again**, or **✕** dismiss what isn't real work."] },
      { title: "From LevelUp", items: ["In LevelUp: **Fleet → Make a key**; here: **LevelUp → Connect** with the address and key.", "Tasks handed off in LevelUp appear here with **Waiting for your approval** and the proposed machine; change who does it if you like, then **Approve** (or approve in LevelUp).", "**Areas**: a work folder per client / Personal, and an area per repository; filter the board by area."] },
    ],
    tips: ["*by project* shows each app's open, yours, the fleet's, in progress and done.", "A task that disappears from its document is flagged “no longer in its source”, not deleted.", "“start assigned tasks automatically” is off until you switch it on; it never runs while the fleet is paused.", "A LevelUp hand-off with no repository and no area work folder is answered in writing only."],
    guide: ["work-tasks", "levelup-fleet"],
  },
  "/github": {
    what: "Every repository on your GitHub accounts in one place: what changed, what is waiting on you, and a written report for each, plus an overview with priorities.",
    useFor: ["Seeing what happened across all your projects this week", "Finding reviews, failing checks, issues and to-dos that need you", "Reading each project's own status documents' “waiting on you” items in one list"],
    steps: [
      { title: "First time", items: ["In a normal PowerShell window (not one inside the Claude app) run `gh auth login --hostname github.com --git-protocol https --web` and approve in the browser.", "Run it again signed in to the browser as your other account.", "Come back here and press **Refresh**: a few minutes later the report appears."] },
      { title: "Read it", items: ["**This period in your repositories**: the overview and your priorities.", "**Waiting on you**: everything that needs you, most urgent first; filter by kind.", "**Repositories**: one card each with its report; **details** shows commits, pull requests, issues and its status documents.", "**Your activity**: what your accounts did on GitHub."] },
    ],
    tips: ["Choose 7, 14 or 30 days and press Refresh.", "It refreshes by itself once a day on a computer where the GitHub CLI is signed in.", "The reports are written by Claude with every tool switched off; private repository details stay on this computer."],
    guide: ["github-dashboard"],
  },
  "/runs": {
    what: "Hand over a project: it is planned into tasks, done by real AI sessions, checked, retried and delivered.",
    useFor: ["Anything bigger than one chat answer", "Work in a project folder, optionally with file edits", "Getting cheap/free models to do the easy parts and Claude the hard ones"],
    steps: [{ title: "Start a run", items: RUN_STEPS }, { title: "Optional: checks (proof the work runs)", items: ["Tick *Tasks may edit files there* → **Checks for this folder**.", "Add commands this computer may run as proof, e.g. `npm test`. **Try it** runs one now.", "Tasks that change files can then be required to pass them before review."] }],
    tips: [
      "Tasks show who did them (Local model, Hermes, Codex or Claude) and, if it was another computer, where.",
      "*Spread over my computers* lets answer-only tasks run on your other computers when this one is busy. Those computers need this version and *Replies from my other machines* turned on.",
      "*Work on a git branch*: in a git project with nothing uncommitted, the run's file changes land on their own branch, one commit per task. You merge it when you want it.",
      "Open a task to see each attempt and how it ended. **Worker record** shows how often each AI's work passed review; the next plan for the same project is told what went wrong last time.",
      "A run keeps going after a restart; the computer that started it drives it.",
    ],
    guide: ["orchestrator-attention"],
  },
  "/auto": {
    what: "Chat with the smart router: it sends each message to the cheapest AI that can handle it, and says who answered.",
    useFor: ["Everyday questions when you don't care which AI answers", "Saving your Claude allowance for hard work"],
    steps: [{ title: "Use it", items: ["Type and press Enter.", "Read the routing line under the answer: which AI and why.", "**Who Auto Can Use** (on this page) lists the pool; AIs billed per use are left out until you tick them."] }],
    tips: ["**Test failover** (How Routing Works) makes Auto's first choice fail on purpose and shows who answered instead. Nothing is changed."],
    guide: ["auto", "chat-features"],
  },
  "/claude": {
    what: "A chat with Claude Code on this computer, with live progress and tools.",
    useFor: ["Work that needs Claude's full abilities: files, commands, code", "Long conversations (the session continues across messages)"],
    steps: [{ title: "Before you send", items: ["Pick the model (Sonnet, Opus, Haiku).", "Pick how much it may do alone: **Safe** (default), **Plan** (read-only), **Auto-Edit** (file edits allowed), **Full Access** (anything, including commands — trusted prompts only).", "The trash icon starts a fresh session."] }],
    guide: ["claude", "chat-features"],
  },
  "/openclaw": {
    what: "Chat with OpenClaw (Talos), the assistant that also lives in your Telegram.",
    useFor: ["The same conversation you have on your phone, at your desk", "Approving things from Telegram"],
    guide: ["telegram"],
  },
  "/hermes": {
    what: "Chat with Hermes, the Nous Research agent, on your Nous Portal plan.",
    useFor: ["Research and quick tasks on a free or cheap model", "Web look-ups"],
    tips: ["Each message is independent: Hermes doesn't remember the previous message on this page.", "If it fails with \"No access token\", Health on Command tells you how to sign it back in."],
    guide: ["agents", "companions"],
  },
  "/hermes-lab": {
    what: "Two power tools for Hermes: Goal Mode (give it a long goal and walk away) and the Control Room (Hermes's own dashboard).",
    useFor: ["A long autonomous Hermes job with a Telegram ping when done", "Hermes's settings, models, skills and logs"],
    tips: ["Goal Mode lets Hermes act without asking. Give it goals you'd trust it with.", "Local Services on this page starts the Hermes dashboard or Ollama if they're down."],
    guide: ["studio-suite", "troubleshooting"],
  },
  "/mastermind": {
    what: "A group chat with every agent at once. They answer in turn, each seeing the others' replies.",
    useFor: ["Brainstorming", "Stress-testing a decision from several models' points of view"],
    tips: ["Type **@claude** (or another agent's name) to ask just that one."],
    guide: ["studio-suite"],
  },
  "/jarvis": {
    what: "Voice control: talk to navigate the app or ask questions and hear the answer.",
    useFor: ["Hands-free questions", "\"Go to the pipeline\"-style navigation"],
    steps: [{ title: "Use it", items: ["Click **Start listening** (Chrome or Edge) and allow the microphone.", "Say a page to open it, or ask anything; Auto answers out loud.", "There's a typed box if you'd rather not talk."] }],
    guide: ["studio-suite"],
  },
  "/pipeline": {
    what: "From rough idea to finished work with one approval: drop an idea, it is sorted, and projects are built after you approve.",
    useFor: ["Capturing ideas without deciding what to do with them yet", "Turning an approved idea into a deliverable automatically"],
    steps: [{ title: "Use it", items: ["Type the idea into the Inbox.", "Claude classifies it. Small things are filed to your journal.", "Projects wait in **Human Gate** (it glows amber): click **Approve** to build it.", "It lands in *Shipped & Filed* with the result."] }],
    guide: ["studio-suite"],
  },
  "/builds": {
    what: "Ask Claude for a small game or web app in one file, and play it right here.",
    useFor: ["Quick prototypes, toys, calculators, mini-games"],
    tips: ["Builds save to the vault, so the shelf is the same on every computer."],
    guide: ["studio-suite"],
  },
  "/studio": {
    what: "Make images, spoken audio and video from a prompt, using provider APIs (billed per use).",
    useFor: ["Pictures (OpenAI or Gemini)", "Voice-overs (OpenAI or ElevenLabs)", "Short videos (Replicate)"],
    steps: [{ title: "First time", items: ["Add a key in **Settings → API Keys** for the medium you want.", "Come back, pick the tab, type the prompt, Generate."] }],
    guide: ["studio"],
  },
  "/content": {
    what: "Turn a keyword into an SEO blog article, score it, and publish it as a draft.",
    useFor: ["Blog posts", "Pushing drafts to WordPress, Ghost or Webflow"],
    steps: [{ title: "Use it", items: ["Type the target keyword and pick a writer.", "Read the draft and its SEO score (expand it to see which checks passed).", "Optional: generate a hero image (needs an image key).", "Export, or **Push to …** (connect sites in Settings → Publishing). It arrives as a draft."] }],
    guide: ["content-pipeline"],
  },
  "/import": {
    what: "Fold your old ChatGPT and Claude history into the shared brain.",
    useFor: ["Giving your agents the background of everything you've already worked through"],
    steps: [{ title: "Use it (on one computer only)", items: ["Export your data from ChatGPT and/or Claude (Settings → Data / Privacy → Export).", "Drop the ZIP in Documents\\llm-exports.", "**Scan** (free, local) to preview.", "**Distill** with a writer and a per-run limit; re-run to continue."] }],
    guide: ["history-import"],
  },
  "/conversations": {
    what: "Search every chat you've had with every agent, on every computer.",
    useFor: ["\"What did Claude say about X last month?\"", "Seeing what you talk about most (Analytics tab)"],
    tips: ["Filter with the agent and machine chips; *AI summary* writes a one-line summary of a result.", "Imported history shows with a violet IMPORTED badge."],
    guide: ["conversations"],
  },
  "/missions": {
    what: "Send a task to one or more agents in the background, now, on a schedule, or when something happens.",
    useFor: ["Several AIs on one question (Mixture of Agents, Debate, Pipeline)", "Scheduled jobs (daily brief, weekly report)", "Watchers that react to files, goals or memories"],
    steps: [
      { title: "Launch a mission", items: ["Write the task.", "Pick a strategy: **Single**, **Mixture of Agents** (all answer, best merged), **Debate** (two argue, a judge decides) or **Pipeline** (each improves the last).", "Tick the agents and Launch. You can close the tab."] },
      { title: "Schedule it", items: ["Switch the launcher to **On a schedule**.", "Choose how often, the time, and Telegram or vault-only.", "Use `{{today}}` or `{{recent_notes}}` in the prompt for fresh context."] },
    ],
    tips: ["Every finished mission is saved to the vault (Agentic OS/Missions).", "Create schedules on the master computer: that is where they run."],
    guide: ["missions", "schedules", "watchers", "playbook"],
  },
  "/tasks": {
    what: "Your to-do board (Pending → In progress → Done), plus the Orchestrator for quick multi-agent deliverables.",
    useFor: ["Tracking your own work", "Seeing tasks the AIs created (they start with 🤖 or 🧭)"],
    tips: ["Drag cards between lanes. It's the note Agentic OS/Tasks.md, so it syncs and you can edit it in Obsidian."],
    guide: ["ops-pages", "orchestrator-attention"],
  },
  "/schedule": {
    what: "A calendar of everything that runs by itself, and when it runs next.",
    useFor: ["Checking what will happen today and this week", "Pausing, renaming or running a schedule now"],
    tips: ["New schedules are created on the Missions page (On a schedule)."],
    guide: ["ops-pages", "schedules"],
  },
  "/library": {
    what: "Every document the AIs have written into the vault, with a reader.",
    useFor: ["Reading mission results, weekly summaries, reports and run deliveries", "Downloading or opening them in Obsidian"],
    guide: ["ops-pages"],
  },
  "/graph": {
    what: "A map of your vault: notes are dots, links between notes are lines.",
    useFor: ["Seeing how your knowledge connects", "Finding unlinked (orphan) notes"],
    tips: ["Scroll to zoom, drag to move, click a dot to open the note in Obsidian; the folder chips filter."],
    guide: ["knowledge-graph"],
  },
  "/arena": {
    what: "Give the same prompt to 2-4 AIs side by side and crown the best answer.",
    useFor: ["Comparing models on your real work", "Teaching Auto which AI to use for which kind of task"],
    tips: ["Run battles one at a time when a local model or Hermes is fighting.", "Crown easy battles too, without Claude, so cheap models can win the easy work."],
    guide: ["arena-analytics-evals"],
  },
  "/analytics": {
    what: "What your AI use costs and how it performs.",
    useFor: ["Real per-use spend and the month-end projection", "Subscription use (estimated, not billed)", "Which agents are slow or failing"],
    guide: ["arena-analytics-evals"],
  },
  "/reports": {
    what: "18 ready-made reports built from everything the app records, exportable as Markdown, HTML or a vault note.",
    useFor: ["A one-page Executive Brief", "Cost, reliability, topics, productivity"],
    guide: ["reports"],
  },
  "/evals": {
    what: "A test suite for AIs: run saved test questions against agents and get scored report cards.",
    useFor: ["Checking whether a model is good enough for a job", "Tracking quality over time"],
    tips: ["Each answer is judged by Claude, so a run uses Claude allowance."],
    guide: ["arena-analytics-evals"],
  },
  "/goals": {
    what: "A checklist of goals for the active workspace, synced with a note in your vault.",
    useFor: ["Tracking what you're aiming for", "Letting agents add goals (\"add a goal to …\")"],
    guide: ["goals-journal"],
  },
  "/journal": {
    what: "One page per day that saves as you type; agents add timestamped notes too.",
    useFor: ["Daily notes", "Seeing what agents logged today"],
    tips: ["The heatmap shows your writing over 12 weeks; click a day to open it."],
    guide: ["goals-journal"],
  },
  "/memory": {
    what: "The facts every agent reads before answering, on every computer.",
    useFor: ["Telling all your AIs something once", "Correcting a wrong fact they keep repeating"],
    tips: ["You can also say \"remember …\" to any agent in chat. Local models can read memory but never add to it."],
    guide: ["memory-rag", "user-profile"],
  },
  "/settings": {
    what: "Set-up for this computer and your network: AIs, keys, profile, publishing, workspaces, machine group, phone access.",
    useFor: ["Adding an AI with an API key", "Editing what every agent knows about you (User Profile)", "Joining or changing this computer's role in the machine group", "Turning on phone access"],
    tips: ["Keys stay on this computer; they never sync.", "Settings → This network holds the Telegram bot and the app's name for all computers."],
    guide: ["settings-env", "api-llms", "multi-machine", "new-network"],
  },
  "/": {
    what: "One box for everything: ask about or control the fleet, start an agent on a machine, or just chat.",
    useFor: ["Asking what is running, waiting or failing anywhere", "Starting a job on the best machine without picking one", "A quick answer from the best available model"],
    steps: [{ title: "Use it", items: ["Type and press Enter. **Auto** shows where it will go (Fleet, Agent or Chat); click one to choose yourself.", "**Fleet** changes arrive as a card: **Yes, run it** or **Cancel**.", "**Agent**: pick the tool, the machine (or Auto), and whether it may change files."] }],
    tips: ["The diagram below is live: engines on the left, your machines on the right.", "The old home page is **Overview** in the menu."],
    guide: ["hub-board-agents"],
  },
  "/city": {
    what: "Everything the fleet is doing or waiting on, as an office (one room per machine) or a board with five columns.",
    useFor: ["Seeing what is running and on which machine", "Settling what waits on you: approvals, reviews, permission prompts", "Stopping or starting work from one place"],
    steps: [{ title: "Use it", items: ["**Office**: click a bot to see what it is and settle it.", "**Board**: the buttons on each card do the same as on that item's own page.", "Search, or pick a machine, to narrow the board."] }],
    tips: ["Your own to-dos stay in Work: this is the fleet's work."],
    guide: ["hub-board-agents"],
  },
  "/agents": {
    what: "Your own standing agents: a name, a persona, a task, the tool and machine it runs on, and an optional schedule.",
    useFor: ["Work you want done the same way again and again", "A daily or weekly check that reports back"],
    steps: [{ title: "Make one", items: ["**+ New agent**, or **+ Add** on a starter and change anything.", "Machine **Auto** uses the best machine at the time.", "**Run** starts it now; add a note for that run if you like."] }],
    tips: ["Scheduled runs are started by the master machine and wait while the fleet is paused.", "If the chosen machine isn't signed in, an Auto run moves to the next one and tells you."],
    guide: ["hub-board-agents"],
  },
  "/tools": {
    what: "Short forms that produce a finished piece of writing, plus every Claude skill on this machine.",
    useFor: ["A proposal, an email, a brief or a checklist in a minute", "Running one of your skills without opening a session"],
    steps: [{ title: "Use it", items: ["Pick a tool, answer its questions, **Run it**.", "**+ Make a tool**: write the prompt with {name} where an answer goes.", "Results are saved on the right: copy or download."] }],
    tips: ["A skill runs as a Claude Code session, answer only, and can take a few minutes."],
    guide: ["hub-board-agents"],
  },
  "/connections": {
    what: "Every AI sign-in by machine, the services the fleet uses, extra models, and what your subscriptions cost.",
    useFor: ["Seeing which machine isn't signed in to which tool", "Checking a service is connected", "Tracking what you pay and when it renews"],
    tips: ["**Check all** asks every machine again.", "Keys' values are never shown here."],
    guide: ["hub-board-agents"],
  },
  "/levelup": {
    what: "The hand-offs from LevelUp, your planning app: connect, approve plans, follow the work, review results.",
    useFor: ["Approving what you delegated from LevelUp", "Seeing what the fleet did for each client or personal goal"],
    steps: [{ title: "Use it", items: ["Connect once with a key made in LevelUp (Fleet → Make a key).", "**Approve** a plan to let it start; **Accept** a result when it is right.", "Send something back with a note from LevelUp."] }],
    tips: ["Areas and their work folders are set in Work → LevelUp → Areas.", "Switch this page off in Modules if you don't use it."],
    guide: ["levelup-fleet", "hub-board-agents"],
  },
  "/modules": { what: "Switch whole features on or off, for every machine.", useFor: ["Removing pages you don't use from the menu", "Stopping LevelUp or the GitHub report for a while"], tips: ["Nothing is deleted; switch a module back on and it is as you left it."], guide: ["hub-board-agents"] },
  "/appearance": {
    what: "Change the look of the app: theme, colours, fonts, sizes, background, the menu's order and where it sits.",
    useFor: ["Making it easier to read", "Making it yours: your colours, fonts and background picture", "Putting the pages you use first, hiding the rest", "Choosing your start page"],
    steps: [
      { title: "Quick", items: ["Pick a **preset**, then adjust Look, Type, Layout and Behavior.", "**Menu position**: left, right or across the top."] },
      { title: "Fully custom", items: ["**Colors**: any colour for each accent, background, panel and text tone (dark and light separately).", "**Fonts and sizes**: any installed font, zoom 70–160%, corner roundness, panel opacity, menu width.", "**Background**: a colour, a gradient or your own picture (dim and blur it).", "**Menu**: rename, reorder or hide items and groups.", "**Saved looks**: save, switch, and Export / Import to copy a look to another machine.", "**The whole Fleet**: push this look to every machine (each applies it once; a browser can opt out)."] },
    ],
    tips: ["Changes are instant and remembered per browser. **Reset to default** undoes the presets; **Clear custom look** undoes the custom settings.", "Appearance always stays in the menu, so you can't lock yourself out."],
    guide: ["appearance"],
  },
  "/guide": {
    what: "The full reference manual, searchable.",
    useFor: ["Details beyond this Help panel", "Exact settings, files and troubleshooting"],
    tips: ["Agents can read the guide too, so you can also ask any agent how the app works."],
  },
  "/watcher": {
    what: "A trend radar for YouTube channels: it scores their new videos and drafts titles and angles.",
    useFor: ["Spotting trending topics in your niche", "Copy-ready title ideas"],
    steps: [{ title: "Use it", items: ["Add channel IDs (they start with UC…) and keywords to boost.", "It rescans every 4 hours; open a signal for 5 titles and 3 angles."] }],
    guide: ["studio-suite"],
  },
};

export const AGENT_PAGE_HELP: PageHelp = {
  what: "A chat with one agent you added (an API model or a local model).",
  useFor: ["Talking to that model directly, outside Auto"],
  tips: ["API models are billed per use by their provider. Local models are free and can read, but not write, the shared memory.", "Edit it in Settings → LLM Connections (the pencil icon)."],
  guide: ["api-llms", "local-and-coding-agents", "llm-tools"],
};

export function helpForPath(pathname: string): PageHelp | null {
  if (PAGE_HELP[pathname]) return PAGE_HELP[pathname];
  if (pathname.startsWith("/agent/")) return AGENT_PAGE_HELP;
  return null;
}
