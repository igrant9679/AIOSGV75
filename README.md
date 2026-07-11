# Mission Control

A local, dopamine-tuned operations deck for driving **Claude Code** and companion AI agents
(OpenClaw, Hermes, …) from the browser. Next.js + Tailwind v4 + Framer Motion.

Each agent has its own page (`/claude`, `/openclaw`, `/hermes`) with a chat-app interface —
avatars, streaming bubbles, typing indicator. Chats live in a global store, so they survive
switching pages (even mid-run). Every composer has a **mic button** using the browser's
built-in Web Speech API (Chrome/Edge; no API keys) — click, talk, click again to stop;
final phrases are appended to the input.

## Run it

```bash
npm install
npm run dev
# open http://localhost:3000
```

> Setting up a machine from scratch — tools, Obsidian vault sync, agent CLIs,
> multi-machine topology? Follow **[SETUP-NEW-MACHINE.md](SETUP-NEW-MACHINE.md)**.

> Launch it from a normal terminal (not from inside another Claude Code session) so the
> CLI bridge inherits a clean environment.

## The Claude bridge

The **Claude** section pipes your directive into the local CLI:

```
claude -p --output-format stream-json --verbose --include-partial-messages
```

Events are relayed to the browser over SSE — you get live token-by-token output, tool
activity, session id (multi-turn conversations resume via `--resume`), cost, and timing.

**One-time setup:** the CLI must be authenticated for headless use. If runs fail with
`401 Invalid authentication credentials`, either:

- run `claude` once in a terminal and complete the login flow (or `claude setup-token`), or
- create `.env.local` with `ANTHROPIC_API_KEY=sk-ant-…` and restart the dev server.

**Permission modes** in the console toolbar map to `--permission-mode`:

| Mode | Effect |
| --- | --- |
| Safe | tools that need approval are declined (headless default) |
| Plan | read-only planning mode |
| Auto-Edit | file edits auto-approved |
| Full Access | `bypassPermissions` — every tool auto-approved. Trusted prompts only. |

## Companion agents (OpenClaw, Hermes)

Each agent bay runs a **server-side registered** command — the browser can only choose an
agent and send text (piped to stdin, or substituted for `{input}` in the template). Defaults:

| Agent | Command (current `.env.local`) | Override |
| --- | --- | --- |
| OpenClaw | `openclaw agent --agent main --message {input}` | `OPENCLAW_BIN`, `OPENCLAW_CMD` |
| Hermes | `…\hermes.exe -z {input}` (Nous Hermes Agent, full path) | `HERMES_BIN`, `HERMES_CMD` |

Notes:
- OpenClaw turns run against the gateway's `main` agent session, so it keeps memory
  across messages. Replies are **not** delivered to Telegram (`--deliver` is off) — they
  only appear in the dashboard.
- Hermes `-z` is one-shot: each message is an independent run (no cross-message memory).
- If a binary isn't found the bay shows an offline notice with setup hints.

## Obsidian vault ("Agentic OS")

Everything flows into your vault as plain markdown under `<vault>/Agentic OS/`
(vault path defaults to `C:\Users\Admin\Documents\IdrisGV75\IdrisGV75`; override with
`VAULT_DIR` in `.env.local`):

| What | Where | Behavior |
| --- | --- | --- |
| Chats | `Agentic OS/Chats/YYYY-MM-DD.md` | every finished exchange (all agents) appends to the day's log |
| Goals | `Agentic OS/Goals.md` | Obsidian checkbox tasks (`- [ ]`), synced both ways — the app re-reads edits you make in Obsidian; non-task lines you add are preserved |
| Journal | `Agentic OS/Journal/YYYY-MM-DD.md` | one file per day, autosaves ~1s after you stop typing |

The **Goals** page (`/goals`) has checkbox tasks with a progress dial; **Journal** (`/journal`)
is a distraction-free editor with a day switcher. Both take voice input via the mic button.

## Custom LLMs, agents & workspaces (Settings page)

- **LLM connections** (`/settings`): add any OpenAI-compatible provider — presets for
  OpenRouter, DeepSeek, Kimi/Moonshot, GLM/Z.ai, Grok/xAI, Gemini, or fully custom. Each
  becomes its own chat page with streaming, avatar, activity log, and vault logging.
  API keys live in `data/registry.json` (git-ignored, server-side only, redacted from API responses).
- **Command agents**: register any local CLI as an agent (same mechanics as OpenClaw/Hermes).
- **Workspaces**: each gets its own `Goals.md` + `Journal/` under `Agentic OS/Workspaces/<name>/`;
  switch via the dropdown on the Goals/Journal pages.
- **Activity log**: every agent page has a per-agent log panel (filtered event stream).

## Missions (multi-agent orchestration)

The `/missions` page runs one task across several agents at once:

- **Mixture of Agents** — all selected agents answer in parallel; a synthesizer agent merges
  the strongest parts into one final answer.
- **Pipeline** — agents run in your selection order, each improving the previous output.
- **Single** — one agent handles the task.

Any mix of engines works (Claude CLI, Hermes, OpenClaw, custom commands, API LLMs). Runs
execute server-side (they survive page navigation), each agent gets relevant shared memory
injected, and finished missions are archived to `Agentic OS/Missions/` in the vault.

### Scheduled missions

Switch the launcher to **"On a schedule"** to run any mission hourly, daily, or weekly.
The background tick (armed via `instrumentation.ts`, so it runs whenever the server is up —
including the boot server) fires due schedules and can deliver the final answer straight to
your **Telegram** via OpenClaw (`openclaw message send`), or just archive to the vault.
Manage schedules (toggle, run-now, delete) in the Schedules panel on the Missions page.
Set `TELEGRAM_TARGET` in `.env.local` to change the delivery recipient.

## Arena

`/arena`: fire one prompt at 2–4 fighters, read the answers side by side, and crown the
winner. Win rates build a leaderboard that tells you which models deserve MoA seats.

## MCP servers (Claude bridge)

Settings → **MCP Servers**: register stdio commands or http endpoints in Claude Code's
`--mcp-config` format (stored in `data/mcp.json`). Every dashboard Claude run passes the
config along, so registered servers' tools are available in chat and missions. Browse
servers at github.com/modelcontextprotocol/servers.

## Knowledge graph (Obsidian)

Generated notes are woven into a real Obsidian graph:

- `Agentic OS/Home.md` — daily-regenerated map of content linking memory, goals, today's
  journal/chat log, and every agent.
- `Agentic OS/Agents/<Name>.md` — one hub page per agent (auto-created, safe to edit).
- Every chat session heading, memory fact, mission result, and agent journal entry
  wikilinks its agent's hub page, so backlinks and graph view cluster naturally.

In Obsidian's graph view, filter with `path:"Agentic OS"` to see just the OS's brain.

**Link-aware retrieval:** when RAG retrieves a passage containing `[[wikilinks]]`, up to two
linked notes ride along as extra context — the graph's edges feed the agents, not just the eye.

**Vault Librarian:** a weekly schedule (Sundays 18:00, agent: Claude) that reads every note
modified in the last 7 days (`{{recent_notes}}` prompt variable) and writes a Weekly Synthesis
to `Missions/` — themes, cross-note connections as wikilinks, and open threads. Prompt
variables available to any schedule: `{{today}}`, `{{recent_notes}}`.

## Vault-wide RAG

Every markdown note in the vault (journals, chat logs, mission archives, your own notes) is
indexed locally (BM25-style keyword scoring, no embedding API, rebuilt every ~2 min). The top
relevant passages are injected into every agent call alongside shared memory, and you can
search manually from the Memory page or `GET /api/vault/search?q=`.

## Session compaction

Long API-LLM chats fold older turns into a rolling summary once they pass ~16 messages
(keeping the last 8 verbatim) — the summary rides along as system context, so conversations
can run all day without unbounded prompts. The chat's own model summarizes; the local Claude
CLI is the fallback. Claude-bridge chats are excluded (Claude Code compacts itself).

## LLM tool loop (API models become agents)

Every API LLM chat runs an agentic tool loop: models get native function tools —
`search_vault`, `read_note`, `save_memory`, `add_goal`, `list_goals`, `append_journal`,
`request_mission` — executed locally against the vault/OS. Tool calls stream into the chat
as activity cards; `request_mission` still goes through the approval gate. Providers that
don't support the `tools` parameter get one transparent retry without tools.

## Debate, evals, watchers, self-tuning, semantic retrieval

- **Debate strategy** (Missions): agents argue two rounds — openings, then rebuttals — and a
  judge agent rules with a verdict + merged best answer.
- **Evals** (`/evals`): a saved test suite run against any agents, scored 0–10 by a Claude
  judge against per-case criteria; latest-run report card + history.
- **Watchers** (Missions page): event triggers — new file in a folder, goal completed, or a
  shared-memory mention — fire a mission and ping Telegram. Checked every 30s by the
  scheduler tick; first check baselines silently.
- **Ops Tuner**: a seeded weekly schedule that reviews the `{{ops_digest}}` prompt variable
  (usage, arena, evals, schedules, watchers, fleet) and sends tuning recommendations to
  Telegram every Sunday 19:00.
- **Semantic retrieval**: set `EMBED_BASE_URL`/`EMBED_API_KEY`/`EMBED_MODEL` in `.env.local`
  (any OpenAI-compatible embeddings endpoint) and vault search becomes hybrid BM25 +
  cosine, with disk-cached vectors and silent fallback to pure BM25.

## Auto — smart routing

The **Auto** agent (`/auto`, also selectable in Missions/Schedules) routes each task to the
best real model: tasks are tiered (simple / standard / hard) by heuristics, then the router
picks using live signals — Arena win-rates for quality, the usage ledger for cost, latency,
and health (models failing >50% of runs are skipped), and provider cost hints as a prior.
If the chosen model errors, Auto fails over to Claude automatically. Every answer shows who
handled it and why. The router gets smarter as you crown Arena winners and accumulate usage.

## Analytics & voice

- **Analytics** (`/analytics`): every run — chats, missions, schedules, summarizers — is
  recorded to `data/usage.json` (cost, tokens, latency, outcome). The page charts 30-day
  spend, runs/day, spend/day, and per-agent stats. This ledger is the foundation for smart
  routing later.
- **Voice out**: browser-native TTS (no keys). Hover any agent reply for a read-aloud
  button, or flip the speaker toggle at the top of a chat to have every new reply spoken
  automatically (markdown is flattened for listening; code blocks are skipped).

## Verification loop

- **Rendered markdown everywhere** — assistant chat bubbles, mission outputs, and arena
  answers render headings, tables, task lists, and syntax-styled code (raw HTML is never
  rendered). `[[wikilinks]]` become clickable `obsidian://` deep links into your vault.
- **Approval gates** — agent-requested missions (`<mission>` verb) no longer auto-launch:
  a pending card appears at the top of every page with Approve/Reject. Cheap reversible
  verbs (remember/goal/journal) still execute immediately.
- **Approvals from Telegram** — approvals live server-side (`data/approvals.json`) and every
  new one is pushed to your Telegram via OpenClaw. Reply `approve <id>` or `reject <id>`
  to the bot: OpenClaw knows the protocol (documented in its workspace `TOOLS.md`) and
  PATCHes `/api/approvals` locally. Dashboard and phone stay in sync either way.

## OS verbs (agent-operable OS)

Any agent can drive the OS by including tags in a reply — the dashboard executes them and
strips the tags from chat and logs:

| Verb | Effect |
| --- | --- |
| `<remember>fact</remember>` | save to shared memory |
| `<goal>task</goal>` | add a checkbox goal (active workspace) |
| `<journal>note</journal>` | append a timestamped note to today's journal |
| `<mission>task</mission>` | launch a background single-agent (Claude) mission |

Mission outputs are not harvested for verbs, so agents can't recursively spawn missions.

## Shared memory

`Agentic OS/Memory.md` is read by **every** agent before answering (system message for API
LLMs; preamble for CLI agents) and any agent can append to it by including
`<remember>the fact</remember>` in a reply — the app harvests the tag, stamps it with
time + source, strips it from the chat, and refreshes all agents' context. View/edit it on
the Memory page (voice supported), or in Obsidian directly.

## Security notes

- Commands are defined in `lib/agents-config.ts` / env vars only — never accepted from the client.
- Session ids, model names, and permission modes are validated before touching the shell.
- This is a **local** tool. Don't expose the port beyond localhost; the Claude bridge can edit files
  and run commands on this machine when you enable the permissive modes.
