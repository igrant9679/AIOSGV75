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

- **Codex CLI** (the agent, like Claude Code): install (\`npm i -g @openai/codex\`) and authenticate (\`codex login\`, ChatGPT account), then Settings → **Command Agents** → name \`Codex\`, command template \`codex exec --skip-git-repo-check {input}\` (the flag is required — the app spawns it outside a git repo). It becomes a chat page, mission participant, and arena fighter. Note: OpenAI merged the Codex *desktop app* into the ChatGPT desktop app (July 2026) — the **CLI is separate, still maintained, and is what Mission Control uses**; desktop-app sign-in does NOT authenticate the CLI. Its green orb only means the binary exists — if runs 401, check \`codex login status\`.
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
    id: "multi-machine",
    title: "Multi-Machine & Sync",
    keywords: "sync onedrive obsidian sync multi machine second laptop network internet lan chats sessions shared brain vault_dir git pull update railway cloud hosting tailscale primary workstation conflict one engine",
    body: `Mission Control runs a **full instance on each machine**, all sharing one brain. Two channels do the work — and neither needs the machines on the same network:

- **GitHub** ships the *code*: on another machine, \`git clone\` once, then \`git pull && npm run build\` + restart to update. Machines never talk to each other; each runs its own server at its own \`127.0.0.1:3000\`.
- **OneDrive** ships the *brain*: the vault lives inside the OneDrive (LSI Media LLC) folder — \`…\\AI Mission Control\\IdrisGV75\` — so shared memory, RAG, goals, the task board, journal, chat logs, mission archives, and this Guide sync through the cloud. New machine = sign into the same OneDrive, sync the library, point \`VAULT_DIR\` in \`.env.local\` at it, and mark it "Always keep on this device".

**One sync engine, ever.** OneDrive is the chosen mechanism — leave Obsidian's built-in Sync core plugin OFF. Two engines rewriting the same files fight each other and breed conflict copies.

**Chats & sessions across machines** — three layers:
1. *Live threads and CLI sessions are per-machine* (Claude's resumable sessions live in that machine's ~/.claude).
2. *Chat records are shared* — every finished exchange lands in \`Agentic OS/Chats/\` and is readable anywhere (Library page) and searchable via RAG.
3. *The useful contents are shared* — memory facts, goals, journal entries reach every agent on every machine. End sessions with "Remember: … / goal / journal" and any machine picks up the thread.

**Deliberately per-machine:** schedules & watchers (one PRIMARY machine runs them — duplicates double-fire and two Telegram gateways steal each other's updates), API keys, arena standings, and the usage ledger (each machine's Auto learns its own history).

**Why not host it in the cloud (Railway etc.)?** The server is the engine room — it spawns local CLIs, reads the vault from disk, and talks to localhost Ollama; none of that exists in a cloud container, and the dashboard has no auth layer (it can run commands, so it binds 127.0.0.1 only). Remote access, when wanted, = **Tailscale** private mesh, not public hosting.

Full walkthrough for a new machine: **SETUP-NEW-MACHINE.md** in the repo.`,
  },
  {
    id: "ops-pages",
    title: "Task Board, Schedule Calendar & Library",
    keywords: "tasks kanban board pending in progress done operator schedule calendar cron timeline next run library content docs documents viewer download obsidian ops pulse queue integrity disk uptime",
    body: `Three operations pages (inspired by command-center dashboards) round out the workspace:

**🛠 Tasks (/tasks)** — a personal kanban board: **Pending → In Progress → Done**. Add tasks with Enter, move them with ◀ ▶, delete on hover. The stat row shows board totals, scheduled-job count, and the **next cron countdown**. Stored in the vault as \`Agentic OS/Tasks.md\`, so it **syncs across machines** like shared memory and goals — and it's a normal Obsidian note: add a \`- [ ] task\` line under a lane heading by hand and the app adopts it; check a box in Obsidian and it lands in Done.

**📅 Schedule (/schedule)** — the cron calendar: every schedule grouped by frequency (hourly / daily / weekly) with time, delivery target, and next-run countdown; watchers listed alongside; a **7-day timeline** showing exactly what fires on which day. Run-now and on/off toggles work right from the cards. Creating/editing schedules still happens in the Missions launcher.

**📚 Library (/library)** — every markdown document the OS has written into the vault (mission archives, weekly syntheses, chat logs, journal, the Guide), filterable by folder, rendered in a full viewer with **open-in-Obsidian** and **download**. This is the "content folder" pattern: agents save long-form output to files instead of bloating chat context — and the Library is where you read it.

**Overview upgrades** — Host Vitals now reports **disk usage** and **data-store size** alongside CPU/RAM/uptime (your VPS/Local Computer at a glance), plus the **Ops Pulse** tile (mission queue, runs today, errors today, fleet integrity N-of-M) and **Fleet Activity** — a 7-day per-agent run chart with success rates from the usage ledger.`,
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

**📥 Pipeline (/pipeline)** — from inbox to shipped, one human checkpoint. Drop any idea; Claude classifies it (project · action · idea · reference · escalate) with a confidence score and tags. Small items file straight to your vault journal; **projects wait at the Human Gate for your one Approve**, which launches an Orchestration to build the deliverable — then it lands in Shipped & Filed with the result. The board self-advances as builds finish.

**🎙 JARVIS (/jarvis)** — a voice command center for the whole OS. Click Start listening (Chrome/Edge) and speak: say "go to watcher" / "open the pipeline" to navigate, or ask anything ("what should I build next?") and the Auto agent answers out loud. Optional "Jarvis" wake word, selectable voice, and a typed fallback. Built on the browser's Web Speech API — no keys.`,
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
    id: "content-pipeline",
    title: "SEO Content Pipeline & Publishing",
    keywords: "content seo blog article writing publish wordpress draft keyword meta description slug rank hero image export markdown html",
    body: `**Content** turns a keyword into a ready-to-publish blog article. Give it a target keyword, pick a writer (Claude, Auto, or any agent), and it drafts an SEO-optimized piece: title, meta description, slug, secondary keywords, a structured Markdown body, and a hero-image prompt. Articles save to the vault under \`Agentic OS/Content/\` (with YAML frontmatter) so they sync everywhere.

**SEO score** — every draft is graded against a local 9-point checklist (no API): keyword in title/meta/intro, title & meta length, H2 count, word count, clean keyworded slug, secondary keywords. The score (0–100) shows on each card; expand an article to see which checks passed.

**Hero image** — one click generates a hero via the Studio image engine (needs an OpenAI or Gemini key). It's stored with the article and shown in the detail view.

**Getting it out**
- **Export** — download the Markdown, or copy clean HTML to paste anywhere.
- **Publish to WordPress** — connect a site in **Settings → Publishing** (site URL + username + an **Application Password** from WordPress → Users → Profile). Then "Push to WordPress" creates the post **as a draft** (you review and hit publish inside WP). Credentials live in \`data/publish.json\` (git-ignored) or \`WP_SITE\`/\`WP_USERNAME\`/\`WP_APP_PASSWORD\` env vars.

Without a WordPress connection the pipeline still works end-to-end — you just export instead of pushing.`,
  },
  {
    id: "orchestrator-attention",
    title: "Orchestrator & Needs Attention",
    keywords: "orchestrator chief of staff delegate goal decompose dispatch review rework assemble subtasks auto route cheap tokens conserve needs attention stalled blocked waiting pending nudge reminder",
    body: `**🤖 The Orchestrator** (panel on the Tasks page) is the chief-of-staff loop — hand it one goal and it runs the whole show:

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
    title: "The Knowledge Graph (in-app & Obsidian)",
    keywords: "obsidian vault graph knowledge map wikilinks backlinks home agent hub pages notes librarian nodes edges orphans hubs force visualization",
    body: `Everything the OS writes lands in your vault under **Agentic OS/** as linked markdown:

- **Home.md** — daily-regenerated map of content linking memory, goals, the task board, today's journal/chats, and every agent
- **Agents/<Name>.md** — one hub page per agent; every chat log heading, memory fact, mission result, and journal entry wikilinks back to its author
- **Chats/** (one file per day) · **Missions/** (one per mission) · **Journal/** · **Goals.md** · **Tasks.md** · **Memory.md**

**🕸 Graph (/graph)** — the built-in visualization: every vault note is a node, every resolved \`[[wikilink]]\` an edge, laid out live by a force simulation. Node size = connection count, color = folder (legend chips filter to one folder), hover highlights a note's neighborhood, **scroll zooms, drag pans or moves nodes, click opens the note in Obsidian**. The stat row counts notes, links, **orphans** (unlinked notes — feed them to the Librarian), and the top hub. Refresh re-reads the vault.

Obsidian's own graph view works too (filter \`path:"Agentic OS"\`), and any agent page's **backlinks pane** is a complete dossier of that agent's activity. The Vault Librarian weaves a synthesis note through the graph every Sunday.`,
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

Field lessons from real battles (2026-07):
- **Crown easy battles too.** Hard battles teach the router who the champion is (Claude); *easy* battles — summaries, rewrites, short explainers — are where cheap models earn wins, and that's the evidence the "simple" tier needs to route cheaply with confidence. Leave Claude out of easy battles so the budget fighters compete on winnable ground.
- **One battle at a time when local/CLI fighters are involved.** Launching several battles at once means several simultaneous runs per agent — cloud APIs shrug, but CPU-bound Ollama models and one-shot CLIs (Hermes) choke and error. Sequential battles give fair results.
- **Reruns aren't independent.** Finished battles archive to the vault, so a rerun of a similar prompt lets fighters *retrieve earlier answers via RAG* — a small model can echo a rival's archived answer nearly verbatim. Judge with that in mind.
- **A no-show isn't a loss.** If a fighter errors, exclude it from the recorded vote rather than counting a phantom defeat.

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
    body: `**Settings page**: LLM connections · **API Keys** for creative providers (OpenAI/ElevenLabs/Replicate) · custom command agents (any local CLI becomes an agent — \`{input}\` placeholder or stdin) · MCP servers for the Claude bridge · workspaces.

**Where keys live** — LLM keys sit in \`data/registry.json\`; creative-provider keys in \`data/services.json\`. Both are entered in the UI and never leave this machine (both git-ignored). Any key can instead be set as an \`.env.local\` variable, which the app uses as a fallback.

**\`.env.local\` reference** (restart the server after changes):

| Variable | Purpose |
| --- | --- |
| \`OPENCLAW_BIN\` / \`OPENCLAW_CMD\` | OpenClaw binary/command template |
| \`HERMES_BIN\` / \`HERMES_CMD\` | Hermes binary/command template |
| \`TELEGRAM_TARGET\` | Telegram recipient id (defaults to your account) |
| \`EMBED_BASE_URL/API_KEY/MODEL\` | activates semantic retrieval |
| \`OPENAI_API_KEY\` | Studio image + voice (fallback for the Settings field) |
| \`GEMINI_API_KEY\` | Studio image via Google Gemini (fallback) |
| \`ELEVENLABS_API_KEY\` | Studio premium voices (fallback) |
| \`REPLICATE_API_TOKEN\` | Studio video (fallback) |
| \`WP_SITE\` / \`WP_USERNAME\` / \`WP_APP_PASSWORD\` | WordPress publishing target for the Content pipeline (fallback for Settings → Publishing) |
| \`VAULT_DIR\` | Obsidian vault path override |
| \`ANTHROPIC_API_KEY\` | alternative Claude auth (instead of CLI login) |

**Data files** (\`data/\`, git-ignored): registry.json (LLMs + keys) · **services.json (creative API keys)** · **publish.json (WordPress connection)** · missions.json · schedules.json · watchers.json · approvals.json · usage.json · evals.json · arena.json · mcp.json · embeddings-cache.json.`,
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
