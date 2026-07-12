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

**After code changes** — the background server serves a production build; run \`npm run build\` then restart (stop.cmd → desktop shortcut) to pick up changes.`,
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

The gateway runs as a Windows Scheduled Task (starts on boot). If the bot goes silent, check \`openclaw gateway status\` in a terminal. Note: only **dashboard** conversations are logged to the vault — Telegram-side chats live in OpenClaw's own memory.`,
  },
  {
    id: "api-llms",
    title: "Adding LLMs (Kimi, Grok, Gemini…)",
    keywords: "add llm api key provider preset openrouter deepseek kimi moonshot glm grok gemini custom settings insufficient balance 402 401",
    body: `Settings → **LLM Connections** → pick a provider preset (OpenRouter, DeepSeek, Kimi, GLM, Grok, Gemini, or Custom for any OpenAI-compatible endpoint), paste your API key, choose an accent color. The agent appears in the sidebar instantly.

- Keys are stored **server-side only** in \`data/registry.json\` (git-ignored, never sent to the browser).
- **To edit an agent**: click the pencil icon on its row in Settings → LLM Connections — every field is editable in place (name, provider, base URL, model, API key, system prompt, accent). Leave the key blank to keep the current one; tick **remove key** when switching to a keyless localhost endpoint. Switching accounts = paste the new key (and base URL if the provider changed).
- Error cheat-sheet: **401** = bad key · **402** = valid key, no credit (DeepSeek is prepaid — top up at platform.deepseek.com) · **429** = rate limit.
- **Gemini** has a free tier: aistudio.google.com, no card required.
- **Ollama (local models)**: install from ollama.com, \`ollama pull llama3.2\`, then add a Custom LLM with Base URL \`http://localhost:11434/v1\`, model = the model you pulled, and **no API key** (localhost endpoints don't need one). Free, private, offline.
- **OpenAI / Codex models**: Custom preset with Base URL \`https://api.openai.com/v1\` + your OpenAI key. The Codex **CLI** plugs in as a Command Agent instead (template \`codex exec --skip-git-repo-check {input}\`).

Every API LLM automatically gets: shared memory + vault RAG context, **native function tools** (see LLM Tools), session compaction for long chats, voice in/out, and vault chat logging.`,
  },
  {
    id: "local-and-coding-agents",
    title: "Ollama, Codex & Local Models",
    keywords: "ollama local model llama qwen mistral free offline private lm studio codex openai cli coding agent gpt keyless no key localhost 11434",
    body: `**Ollama — free, private, offline models on your own hardware**

1. Install from **ollama.com**, then pull a model in a terminal: \`ollama pull llama3.2\` (other good picks: \`qwen2.5\`, \`mistral\`, \`deepseek-r1\`)
2. Settings → Add LLM → provider **Custom**:
   - Base URL: \`http://localhost:11434/v1\`
   - Model: the model you pulled (e.g. \`llama3.2\`)
   - API key: **leave blank** — localhost endpoints don't need one
3. The agent appears in the sidebar instantly, with everything included: streaming chat, shared memory + vault RAG, the function-calling tool loop (tool-capable models like llama3.1+ and qwen2.5 can search your vault and file goals), Arena, MoA, debate, and Auto routing — at $0.00 per token.

Notes: local speed/quality depends on your hardware — 7–8B models run comfortably on 24 GB RAM. **LM Studio** works the same way (Custom, \`http://localhost:1234/v1\`, no key).

**Codex — OpenAI's coding agent**

- **Codex CLI** (the agent, like Claude Code): install and authenticate it, then Settings → **Command Agents** → name \`Codex\`, command template \`codex exec --skip-git-repo-check {input}\`. It becomes a chat page, mission participant, and arena fighter — try a Claude-vs-Codex debate on a code question with a third model judging.
- **OpenAI API models**: Settings → Add LLM → Custom → Base URL \`https://api.openai.com/v1\` + your OpenAI key. Full tool-loop citizen like any other API LLM.`,
  },
  {
    id: "llm-tools",
    title: "LLM Tools (Function Calling)",
    keywords: "tools function calling search_vault read_note save_memory add_goal list_goals append_journal request_mission agentic loop",
    body: `API LLMs aren't just chatbots — each chat runs an agentic tool loop with seven native tools, executed locally:

| Tool | Effect |
| --- | --- |
| \`search_vault\` | search your entire Obsidian vault |
| \`read_note\` | read any vault note by path |
| \`save_memory\` | write to shared memory |
| \`add_goal\` / \`list_goals\` | manage your goals |
| \`append_journal\` | timestamped journal entry |
| \`request_mission\` | request a background Claude mission — **goes through your approval gate** |

Tool activity streams into the chat as dim cards (call → result), then the model continues its answer. Models can chain up to 5 tool rounds. Providers without tool support get a transparent retry without tools.`,
  },
  {
    id: "auto",
    title: "Auto — Smart Routing",
    keywords: "auto router routing tier simple standard hard failover cheapest arena win rate health",
    body: `**Auto** is a virtual agent that picks the right real model per task:

- **Simple** (short, factual) → the cheapest ready model
- **Standard** → the best proven performer by Arena win-rate
- **Hard** (code, analysis, writing) → the reigning Arena champion

It also reads the usage ledger for **health** — models failing more than half their recent runs are skipped — and **fails over to Claude** automatically if the chosen model errors. Every answer shows a routing line: who answered and why. Auto works in chat, missions, and schedules. It gets smarter as you crown Arena winners and accumulate usage data.`,
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

Missions run **server-side** — close the tab, they keep flying. Each agent gets relevant shared memory injected. Results show per-agent timing and outputs (with \`auto → whoever\` routing labels), and every finished mission is archived to \`Agentic OS/Missions/\` in your vault with wikilinked attribution.`,
  },
  {
    id: "schedules",
    title: "Schedules & Prompt Variables",
    keywords: "schedule cron hourly daily weekly recurring librarian ops tuner telegram delivery run now prompt variables recent_notes ops_digest today",
    body: `Switch the mission launcher to **"On a schedule"**: hourly / daily / weekly, delivered to **Telegram** or vault-only. The Schedules panel shows next-run time, last outcome, ON/OFF toggle, ▶ Run now, and delete.

**Prompt variables** (expanded at run time):
- \`{{today}}\` → the date
- \`{{recent_notes}}\` → digest of vault notes modified in the last 7 days
- \`{{ops_digest}}\` → usage/arena/evals/schedules/watchers operations summary

**Pre-installed:**
- **📚 Vault Librarian** (Sun 18:00) — reads the week's notes, writes a wikilinked Weekly Synthesis to Missions/
- **🛠 Ops Tuner** (Sun 19:00) — reviews the ops digest and sends tuning recommendations to your Telegram

Schedules fire whenever the PC is on (30-second background tick).`,
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
    id: "ops-pages",
    title: "Task Board, Schedule Calendar & Library",
    keywords: "tasks kanban board pending in progress done operator schedule calendar cron timeline next run library content docs documents viewer download obsidian ops pulse queue integrity disk uptime",
    body: `Three operations pages (inspired by command-center dashboards) round out the workspace:

**🛠 Tasks (/tasks)** — a personal kanban board: **Pending → In Progress → Done**. Add tasks with Enter, move them with ◀ ▶, delete on hover. The stat row shows board totals, scheduled-job count, and the **next cron countdown**. Stored in \`data/tasks.json\` — this is *your* operator board, separate from Goals (vault checkboxes agents can complete) and Missions (agent work).

**📅 Schedule (/schedule)** — the cron calendar: every schedule grouped by frequency (hourly / daily / weekly) with time, delivery target, and next-run countdown; watchers listed alongside; a **7-day timeline** showing exactly what fires on which day. Run-now and on/off toggles work right from the cards. Creating/editing schedules still happens in the Missions launcher.

**📚 Library (/library)** — every markdown document the OS has written into the vault (mission archives, weekly syntheses, chat logs, journal, the Guide), filterable by folder, rendered in a full viewer with **open-in-Obsidian** and **download**. This is the "content folder" pattern: agents save long-form output to files instead of bloating chat context — and the Library is where you read it.

**Overview upgrades** — Host Vitals now reports **disk usage** and **data-store size** alongside CPU/RAM/uptime (your VPS/Local Computer at a glance), plus the **Ops Pulse** tile (mission queue, runs today, errors today, fleet integrity N-of-M) and **Fleet Activity** — a 7-day per-agent run chart with success rates from the usage ledger.`,
  },
  {
    id: "approvals",
    title: "Approvals (The Autonomy Gate)",
    keywords: "approval gate approve reject pending card telegram mission request autonomy",
    body: `When an agent requests a mission (via verb or tool), it doesn't run — it becomes a **pending approval**:

1. An amber card appears at the top of every dashboard page → **Approve** / **Reject**
2. Simultaneously, a 🚦 notification lands in your **Telegram** — reply \`approve <id>\` or \`reject <id>\` from anywhere

Both paths stay in sync; approvals are idempotent (a double-tap can't launch two missions). Approving launches a single-agent Claude mission with the requested task. Cheap reversible verbs (remember/goal/journal) skip the gate.`,
  },
  {
    id: "memory-rag",
    title: "Shared Memory & Retrieval (RAG)",
    keywords: "memory shared remember facts retrieval rag search vault semantic embeddings hybrid bm25 context injection",
    body: `**Shared memory** (\`Agentic OS/Memory.md\`) is the communal brain — every agent reads relevant facts before answering, and any agent can add facts. View, edit, or dictate on the Memory page; it's also a normal Obsidian note.

**How context injection works:** for each message, the OS retrieves the ~8 most relevant memory facts **plus the top passages from your entire vault** (journals, chat logs, missions, your own notes) and injects them. When a retrieved passage contains \`[[wikilinks]]\`, the linked notes ride along too — the graph's edges feed the agents.

**Semantic upgrade (optional):** add an OpenAI-compatible embeddings endpoint to \`.env.local\`:
\`\`\`
EMBED_BASE_URL=…/v1
EMBED_API_KEY=…
EMBED_MODEL=…
\`\`\`
and retrieval becomes hybrid keyword + meaning, with vectors cached on disk and silent fallback if the endpoint fails.`,
  },
  {
    id: "knowledge-graph",
    title: "The Obsidian Knowledge Graph",
    keywords: "obsidian vault graph wikilinks backlinks home agent hub pages notes librarian",
    body: `Everything the OS writes lands in your vault under **Agentic OS/** as linked markdown:

- **Home.md** — daily-regenerated map of content linking memory, goals, today's journal/chats, and every agent
- **Agents/<Name>.md** — one hub page per agent; every chat log heading, memory fact, mission result, and journal entry wikilinks back to its author
- **Chats/** (one file per day) · **Missions/** (one per mission) · **Journal/** · **Goals.md** · **Memory.md**

In Obsidian's graph view, filter with \`path:"Agentic OS"\` to see the OS's brain — agents as hubs with everything radiating off them. Open any agent's page and the **backlinks pane** is a complete dossier of that agent's activity. The Vault Librarian weaves a synthesis note through the graph every Sunday.`,
  },
  {
    id: "goals-journal",
    title: "Goals, Journal & Workspaces",
    keywords: "goals checkbox tasks journal daily workspace switch default work progress dial",
    body: `**Goals** — checkbox tasks with a progress dial, synced two-way with \`Goals.md\` (check things off in Obsidian or here; your extra notes in the file are preserved). Agents can add goals via verb or tool.

**Journal** — one file per day, autosaving as you type, with a day switcher, word counts, and voice dictation. Agents append timestamped, attributed entries.

**Workspaces** — create them in Settings (e.g. Work, CommunityForce); the dropdown on Goals/Journal switches context. Each workspace keeps its own \`Goals.md\` + \`Journal/\` under \`Agentic OS/Workspaces/<name>/\`. Agent goal/journal verbs target your **active** workspace.`,
  },
  {
    id: "arena-analytics-evals",
    title: "Arena, Analytics & Evals",
    keywords: "arena battle crown leaderboard win rate analytics cost spend tokens latency ledger evals test cases judge scores report card",
    body: `The measurement suite:

**⚔ Arena** — same prompt to 2–4 models side by side; crown the winner. The leaderboard's win-rates feed the Auto router's choices.

**📊 Analytics** — every run (chats, missions, schedules) is recorded with cost, tokens, latency, and outcome. 30-day spend, runs/day, and per-agent breakdowns. Claude reports real dollars; API models report tokens.

**✓ Evals** — a saved test suite (reasoning trap, instruction-following, concision — add your own cases with scoring criteria). Run it against any agents; a Claude judge scores 0–10 per case. The history panel turns model quality into a trend line. Costs roughly one Claude run per answer judged.`,
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
*Arena.* Pick a task you do often (code review, rewriting, planning) → battle 2–4 models on a *real* example → **crown the winner**. Do this a handful of times and Auto's "hard" tier starts routing to your actual champion instead of a guess. Check /analytics to see if the cheap models are earning their spot.

**7. $0 days (local Llama)**
For drafts, summaries, quick questions: chat with **Llama** directly — free, private, offline, and it can still search your vault and file goals (tool-capable). Auto's "simple" tier already prefers cheap models; crowning Llama in easy arena fights pushes more traffic there.

**8. Build the shared brain deliberately**
End a work session by telling any agent: "Remember: <the three facts worth keeping>. Add a goal: <next step>. Journal: <one-line summary>." Every agent — including Talos on your phone — recalls it afterwards. The brain compounds: the more you save, the sharper every schedule, mission, and RAG answer gets.`,
  },
  {
    id: "settings-env",
    title: "Settings & Environment Reference",
    keywords: "settings env environment variables configuration mcp command agents workspaces vault_dir telegram_target embed openclaw hermes bin cmd",
    body: `**Settings page**: LLM connections · custom command agents (any local CLI becomes an agent — \`{input}\` placeholder or stdin) · MCP servers for the Claude bridge · workspaces.

**\`.env.local\` reference** (restart the server after changes):

| Variable | Purpose |
| --- | --- |
| \`OPENCLAW_BIN\` / \`OPENCLAW_CMD\` | OpenClaw binary/command template |
| \`HERMES_BIN\` / \`HERMES_CMD\` | Hermes binary/command template |
| \`TELEGRAM_TARGET\` | Telegram recipient id (defaults to your account) |
| \`EMBED_BASE_URL/API_KEY/MODEL\` | activates semantic retrieval |
| \`VAULT_DIR\` | Obsidian vault path override |
| \`ANTHROPIC_API_KEY\` | alternative Claude auth (instead of CLI login) |

**Data files** (\`data/\`, git-ignored): registry.json (LLMs + keys) · missions.json · schedules.json · watchers.json · approvals.json · usage.json · evals.json · arena.json · mcp.json · embeddings-cache.json.`,
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    keywords: "error fix broken offline 401 402 port conflict telegram silent hydration stale restart red orb",
    body: `**Agent shows red after PC startup** — cold-start probes can time out; they auto-retry and recover within a minute or two. No action needed.

**Claude fails with 401** — the CLI login expired. Run \`claude\` in a terminal and \`/login\` once.

**API LLM errors** — 401 bad key · 402 no credit (top up with the provider) · a model failing repeatedly is skipped by Auto until it succeeds again.

**Telegram bot silent** — \`openclaw gateway status\` in a terminal; \`openclaw gateway start\` if stopped.

**Port 3000 in use / changes not visible** — run \`stop.cmd\`, then the desktop shortcut. After code edits, \`npm run build\` first (the background server serves the production build).

**Where everything lives** — code: \`Documents/mission-control\` (git → github.com/igrant9679/AIOSGV75) · notes: your vault's \`Agentic OS/\` folder · state: \`data/\` in the project.`,
  },
];

/** Full guide as one markdown document (vault export). */
export function guideMarkdown(): string {
  return [
    `# Mission Control — User Guide`,
    ``,
    `#agentic-os/guide · This note is auto-generated daily from the in-app guide (/guide). Part of [[Agentic OS/Home|Agentic OS]].`,
    ``,
    ...GUIDE_SECTIONS.map((s) => `## ${s.title}\n\n${s.body}\n`),
  ].join("\n");
}
