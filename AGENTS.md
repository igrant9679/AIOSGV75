<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Mission Control — agent context brief

You are working on **Mission Control**, Idris's local AI operating system: a
Next.js 16 + Tailwind v4 + Framer Motion dashboard that orchestrates a fleet
of AI agents with an Obsidian vault as its persistent brain. It runs locally
on port 3000, bound to 127.0.0.1 **only** — it can execute shell commands, so
it must never be exposed to the LAN or internet.

New machine? Human setup steps live in `SETUP-NEW-MACHINE.md`. The in-app user
manual is `/guide` (source: `lib/guideContent.ts`).

## The fleet

| Agent | Kind | How it runs |
| --- | --- | --- |
| Claude | CLI bridge | `app/api/claude/route.ts` spawns `claude -p --output-format stream-json`, relays NDJSON as SSE; prompt via stdin; MCP servers from `data/mcp.json` ride along |
| Talos (OpenClaw) | command agent | `openclaw agent … --message {input}`; also the Telegram gateway (bot pairing, approval replies) — PRIMARY machine only |
| Hermes | command agent | Nous Hermes CLI, one-shot `-z {input}`; absolute path from `.env.local` |
| DeepSeek / any API LLM | OpenAI-compatible | `/api/llm` streaming agentic tool loop (`lib/llmTools.ts`: search_vault, read_note, save_memory, goals, journal, request_mission) |
| Llama | local LLM | Ollama at `http://localhost:11434/v1`, keyless (`isLocalEndpoint()` in `lib/registry.ts`) |
| Codex | command agent | `codex exec --skip-git-repo-check {input}` (needs one-time `codex login`) |
| Auto | virtual router | `lib/router.ts` picks a real agent by task tier, arena win-rate, cost, health; fails over to Claude |

## Map of the code

- `app/api/*` — route handlers: agents, claude, llm, auto, missions, schedules,
  watchers, approvals, arena, evals, registry, mcp, memory, usage, vault
  (incl. `vault/notes` list/read + `vault/graph`), system, tasks,
  orchestrations, attention.
- `lib/` — the engine room: `missions.ts` (MoA/pipeline/debate/arena engine),
  `orchestrator.ts` (goal → plan → dispatch-to-auto-or-pinned-workers →
  review → ≤2 reworks → assemble; kanban + vault + Telegram lifecycle),
  `attention.ts` (blocked-on-owner aggregator + Telegram nudges),
  `tasks.ts` (vault-backed kanban: `Agentic OS/Tasks.md`, hand-edits adopted),
  `schedules.ts` + `scheduler.ts` (30s tick armed in `instrumentation.ts`),
  `watchers.ts`, `approvals.ts` (Telegram-answerable gates), `runners.ts`
  (non-streaming agent execution), `router.ts` (Auto), `retrieval.ts` +
  `vaultSearch.ts` (BM25) + `embeddings.ts` (optional semantic layer),
  `vault.ts` (Obsidian read/write + scaffold), `registry.ts`, `usage.ts`,
  `arena.ts`, `evals.ts`, `llmTools.ts`, `telegram.ts`, `guideContent.ts`.
- Operator pages beyond chat: `/tasks` (kanban + Orchestrator panel),
  `/schedule` (cron calendar), `/library` (vault doc browser), `/graph`
  (canvas force-sim knowledge graph — hand-rolled, no graph lib).
- `components/` — UI: `store.tsx` (global chat/mission state, OS-verb
  harvesting), `Shell.tsx`, `ChatThread.tsx`, `SettingsSection.tsx`,
  `GuideSection.tsx`, `Markdown.tsx` ([[wikilinks]] → obsidian:// links).
- `data/*.json` — runtime state (git-ignored; registry.json holds plaintext
  API keys). `.env.local` — machine config (`VAULT_DIR`, `EMBED_*`,
  `OPENCLAW_CMD`, `HERMES_BIN/CMD`).
- Vault: `VAULT_DIR` → app writes under `Agentic OS/` (Memory.md, Goals.md,
  Journal/, Chats/, Missions/, Agents/, Workspaces/<name>/, Guide.md, Home.md).

## Hard-won rules — do not relearn these the painful way

1. **`data/*.json` is the source of truth. Never module-cache it.**
   `instrumentation.ts` (scheduler) and route handlers are *separate module
   instances*; an in-memory cache in one is invisible to the other. Missions
   use per-mission read-modify-write.
2. **Never cache a failed agent probe permanently.** Cold-booting CLIs time
   out; successes may be cached, failures get a 60s TTL (see `lib/system.ts`
   and the agents route).
3. **`ACCENTS.base` is a CSS var** (`var(--ac-*)`). Never string-concat alpha
   onto it — use `.border`/`.soft`/`.glow`. SVG colors from ACCENTS must go
   via `style={}`, not presentation attributes.
4. **Theme** = `data-theme` on `<html>`, applied by a pre-paint boot script in
   `layout.tsx` (`suppressHydrationWarning` there is intentional).
5. **When you add or change a feature, update `lib/guideContent.ts`** — it's
   the in-app manual *and* it's exported to the vault daily so agents can
   answer questions about the OS via RAG.
6. **OS verbs** (`<remember>`, `<goal>`, `<journal>`, `<mission>`) are
   harvested from chat replies only; mission outputs are never harvested
   (anti-recursion). `<mission>` goes through the approval gate.
7. **Approval protocol is mirrored in OpenClaw's workspace** —
   `~/.openclaw/workspace/TOOLS.md` teaches Talos the curl commands for
   Telegram approvals. If API ports/paths change, update that file too.
8. **The Claude bridge strips `CLAUDE_*`/`ANTHROPIC_*` env vars** (except
   `ANTHROPIC_API_KEY`) from the child so a dev server launched from inside a
   Claude Code session doesn't poison CLI auth.
9. `ChatThread.tsx` has contained a literal NBSP (U+00A0); if exact-match
   editing fails there, that's why.
10. Keyless endpoints: `hasKey` in the registry GET means "ready", which is
    true for localhost base URLs with no key. Authorization headers are only
    sent when a key exists.
11. **In-flight runs die with the server process.** Never rebuild-and-restart
    while a schedule/mission/orchestration is running — check the mission log
    and Ops Pulse queue first.
12. **Don't run concurrent arena battles with local/CLI fighters** (Ollama,
    Hermes) — simultaneous runs per agent make them error. Sequential battles
    only. Cloud APIs tolerate it.
13. Canvas/React traps (from /graph): a conditional *sibling* remounts a
    non-keyed canvas and orphans its animation loop — mount canvases
    unconditionally, overlay empty-states. And rAF is fully suspended in
    hidden tabs — pair every frame with a timer fallback if work must settle
    off-screen.

## Dev cycle (production server auto-starts at login)

- The **prod** server starts at Windows login via `Mission Control Server.vbs`
  (Startup folder) → `server.cmd` → `npm start -- -H 127.0.0.1`.
- Run `stop.cmd` **before** `npm run dev` (port conflict). Note `stop.cmd`
  ends with a `pause` — don't chain it in scripts without piping input.
- After code changes: `npm run build`, then restart via the VBS so the boot
  server serves the new code. The running server keeps old bundles until then.
- Dev serving stale CSS/JS after big edits → `rm -rf .next/dev`, restart dev.
- Verify health: `/api/system`, `/api/agents` (cold-boot probes can take ~45s).

## Multi-machine model

One PRIMARY machine runs schedules, watchers, and the Telegram gateway; other
installs are workstations. The Obsidian vault (synced externally) shares
memory/RAG/goals/journal across machines; `data/*.json`, `.env.local`, and CLI
logins are per-machine. Details: `SETUP-NEW-MACHINE.md`.
