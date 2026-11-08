# Roadmap — Mission Control as an AI second brain

**Goal:** one central place to see, search, remember and direct *all* AI
activity — every tool, every account, every machine — built inside Mission
Control rather than as a separate app.

Three layers:

| Layer | What it means |
| --- | --- |
| **Capture** | Everything flows in: native Claude Code / Codex / OpenCode / Kimi sessions on every machine, ChatGPT / Claude.ai / Kimi app exports, schedules and missions, subscription usage. |
| **Brain** | Organized by project, not by tool: project hubs in the vault, a shared memory server every agent can use, a memory inbox you approve. |
| **Command** | One place to act: activity timeline, Needs Attention across everything, a roles board (manager / workers / reviewer), sending work to a machine + account. |

Ground rules that apply to every phase:

- **Subscriptions, not API keys.** Workers run through each vendor's own CLI
  under your subscription login (`claude -p`, `codex exec`, Kimi CLI). No
  OAuth proxies or token reuse in third-party harnesses.
- **Local-only server.** Stays bound to 127.0.0.1. Cross-machine traffic goes
  through the synced vault, never through an opened port.
- **Never read credentials.** Session readers skip `.credentials.json`,
  `auth.json` and `.key` files.
- **Memories from outside need approval.** Anything written to shared memory
  by a session Mission Control didn't run lands in an inbox first.

## Phase 1 — Capture on this machine + the five pages ✅ (this branch)

- `lib/sessions.ts`: Claude Code + Codex session readers, live status, cached
  by mtime in `data/sessions-cache.json`, time-boxed newest-first indexing.
- Subscription meters: Codex/ChatGPT from recorded rate limits; Claude as
  tokens (limits aren't written to disk); Kimi placeholder.
- `lib/activity.ts` + `GET /api/hub`: one activity stream across sessions,
  chats, missions, orchestrations, memory; plus attention and meters.
- Pages: **Command**, **Timeline**, **Projects**, **Fleet**, **Board**
  (sidebar group "Second brain").

## Phase 2 — Subscriptions and accounts

- CLI workers for Claude, Codex and Kimi, each tied to a login profile
  (`CLAUDE_CONFIG_DIR` / `CODEX_HOME` + an account label).
- "Subscription only" switch: strip `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
  from worker env; force ChatGPT sign-in for Codex.
- Auto router: treat each subscription as a quota pool, cool down a lane that
  hits its limit, route elsewhere; cap reviewer retries.
- Install + wire the Kimi CLI; add its session reader.

## Phase 3 — Brain

- Brain MCP server (stdio) exposing `search_vault`, `read_note`,
  `save_memory`, goals — registered with Claude Code and Codex on each
  machine so native sessions share the brain.
- Memory inbox: memories from native sessions wait for approval.
- Project hub notes: `Agentic OS/Projects/<name>.md`, auto-linking sessions,
  tasks, missions, memories.
- Session transcripts viewable in-app.

## Phase 4 — Capture across machines

- Each machine writes session *summaries* (not transcripts) to
  `Agentic OS/Sessions/<host>/`; Fleet and Timeline show every machine.
- Automatic import of ChatGPT / Claude.ai / Kimi exports dropped in a folder.

## Phase 5 — Roles board (Hermes-style)

- Named roles with description, worker CLI + account, permission mode,
  workspace kind (scratch / worktree / folder).
- Tasks with dependencies, comments as the hand-off channel, "blocked on
  you", full attempt history.
- Manager plans only; reviewer gates "done"; swarm / pipeline / quorum
  templates; blocked items go through approvals + Telegram.

## Phase 6 — Directing work across machines

- Assign a task to `role @ machine / account`. Only the cluster master
  assigns; each machine runs its own workers and writes back only its own
  results. Assignments signed with a per-machine secret kept in `data/`.
