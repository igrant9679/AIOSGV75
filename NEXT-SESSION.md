# Mission Control — Session Handoff

> Give this file to Claude at the start of a new session:
> `Read C:\Users\Admin\Documents\mission-control\NEXT-SESSION.md and continue from there.`
> (Claude Code also has persistent memory of this project — this file is the fast lane and the backup.)

## What this is

**Mission Control** — Idris's local AI operating system at `C:\Users\Admin\Documents\mission-control`
(Next.js 16 + Tailwind v4 + Framer Motion). Built July 9–10, 2026, versions v1 → v18.2.
Repo: **https://github.com/igrant9679/AIOSGV75** (main, gh CLI authenticated as igrant9679).

It orchestrates a fleet of AI agents with an Obsidian vault as its brain:
chats · missions (MoA/pipeline/debate/arena) · schedules with Telegram delivery · watchers ·
approval gates (answerable from Telegram) · shared memory + vault-wide link-aware RAG ·
knowledge graph · smart routing (Auto) · analytics/evals/arena · voice in+out · light/dark ·
built-in searchable guide (`/guide`, also exported to the vault for agent RAG).

## Running state

- **Prod server auto-starts at Windows login** (`Mission Control Server.vbs` in Startup →
  `server.cmd` → `npm start -- -H 127.0.0.1`, port 3000, localhost-only).
- Desktop shortcut "Mission Control" opens it. `stop.cmd` kills it.
- **Dev cycle rule:** run `stop.cmd` BEFORE `npm run dev` (port conflict); after code changes
  run `npm run build` then restart via the VBS so the boot server serves the new code.
  If dev serves stale CSS/JS after big edits: `rm -rf .next/dev` and restart dev.

## Fleet & config state (as of 2026-07-10 night)

| Piece | State |
| --- | --- |
| Claude CLI | authed (interactive `/login` done); bridge strips `CLAUDE_*`/`ANTHROPIC_*` env except `ANTHROPIC_API_KEY` |
| OpenClaw | **named Talos** (IDENTITY.md); gateway = Windows Scheduled Task; Telegram bot **@IdrisGV75_bot** paired (owner id 7284896916); approval protocol lives in `~/.openclaw/workspace/TOOLS.md` — **update it if the API port/paths change** |
| Hermes | Nous Hermes Agent v0.18.2, absolute path in `.env.local`, one-shot `-z {input}` |
| DeepSeek | real key in `data/registry.json`, working |
| Llama (Ollama) | **installed** — Ollama 0.31.2, llama3.2 (tools-capable) + nomic-embed-text pulled; registered keyless at `http://localhost:11434/v1`; Ollama auto-starts (Startup folder) |
| Semantic RAG | **ACTIVE** via local embeddings — `EMBED_BASE_URL=http://localhost:11434/v1`, `EMBED_MODEL=nomic-embed-text` in `.env.local` (keyless). Gemini key now optional (only for a Gemini chat agent; recipe commented in `.env.local`) |
| Codex | CLI 0.144.1 **authed (ChatGPT login) + verified end-to-end** (mission answered 2026-07-11); template `codex exec --skip-git-repo-check {input}` — the flag is required (app spawns from a non-repo cwd) |
| Vault | **moved 2026-07-12 into OneDrive (LSI Media LLC)**: `C:\Users\Admin\LSI Media LLC\Working Files Idris - Documents\AI Mission Control\IdrisGV75` (VAULT_DIR in `.env.local`; pinned "always keep on this device") → app writes under `Agentic OS/` |
| Schedules | 📚 Vault Librarian (Sun 18:00), 🛠 Ops Tuner (Sun 19:00 → Telegram), 📊 **CommunityForce Monday Status (Mon 08:30 → Telegram)**, test schedule (off) |
| Workspaces | Default, Work, **CommunityForce** |
| Arena standings (2026-07-13) | Claude 3/3 · DeepSeek 2/5 · Hermes 1/3 · Llama 0/4 — hard tier has a champion, simple tier has evidence (DeepSeek/Hermes wins on easy battles). Battle lessons live in the Guide's Arena section |
| Laptop (user `idris`) | **deployed 2026-07-12 as WORKSTATION** — vault via OneDrive, Claude + Ollama installed, Talos/Hermes stay desktop-only, schedules empty. Updates: `git pull && npm run build` + restart |
| Settings | **full inline LLM editing** (v19.1) — pencil opens all fields: name/provider/baseUrl/model/key/prompt/accent; blank key keeps current, REMOVE KEY checkbox for keyless localhost |
| Ops pages (v20) | **/tasks** kanban (vault-backed: `Agentic OS/Tasks.md`, syncs across machines, hand-edits adopted), **/schedule** cron calendar (7-day timeline over schedules+watchers), **/library** vault content browser (/api/vault/notes); Overview adds disk/data-store vitals, Ops Pulse tiles, 7-day Fleet Activity |
| Graph (v20.2) | **/graph** knowledge-graph visualization — canvas force sim over /api/vault/graph (notes=nodes, wikilinks=edges), folder legend/filter, hover neighborhoods, click→Obsidian, orphan/hub stats; loop sleeps when settled, timer fallback drives it in hidden tabs (rAF is suspended there) |
| Orchestrator (v21) | **Tasks page panel**: goal → Claude plans ≤5 subtasks → each dispatched to **auto** (cost routing) **or pinned workers** (v21.1: pick ≤4 agents in the launcher, subtasks round-robin — how to leverage Hermes deliberately) → Claude reviews, ≤2 reworks w/ feedback → Claude assembles; vault archive + Telegram + kanban lifecycle (🤖 task; failure → back to Pending). lib/orchestrator.ts, data/orchestrations.json, ≤2 concurrent |
| Needs Attention (v21) | **Overview panel** + /api/attention: pending approvals w/ age, failed missions (24h), stalled runs (>10m), failed schedules; scheduler tick sends one ⏳ Telegram nudge per approval pending >10m (data/attention-nudges.json) |
| Studio suite (v22 · Phase 1 from Julian Goldie's "Agentic OS" screenshots) | **⌘K palette** (Shell), **/mastermind** (fleet group chat, sequential round-robin so agents riff, @-mentions, data/mastermind.json), **/builds** (Claude builds single-file HTML games/apps → vault Agentic OS/Builds/, sandboxed iframe play), **/hermes-lab** (Goal Mode: `hermes chat --yolo --max-turns N` in scratch dir w/ live log tail + Telegram; Control Room: iframe of `hermes dashboard` @127.0.0.1:9119), **/watcher** (keyless YouTube RSS trend radar, recency+keyword+views scoring, AI titles/angles, 4h rescan on scheduler, vault-logged) |
| Studio suite cont. (v22.1) | **/pipeline** (Inbox→Shipped: capture→Claude classifies type/confidence/tags→small items auto-file, projects wait at human gate→approve launches Orchestration→shipped; lib/pipeline.ts reuses orchestrator, syncExecuting on scheduler tick), **/jarvis** (voice command center: Web Speech listen→navigate "go to X" or ask Auto agent→speaks back; wake word + voice picker + typed fallback). Coverage map artifact: https://claude.ai/code/artifact/0b75aba6-1bfe-4187-a40d-37a0056f459d |
| Creative Studio (v23 · Phase 2) | **/studio** — image · voice · video from prompts via paid APIs, outputs saved to vault `Agentic OS/Studio/{images,audio,video}/`. Image = OpenAI gpt-image-1/DALL·E 3 (b64→png); Voice = OpenAI TTS or ElevenLabs (mp3); Video = Replicate predictions (async, polled forward on every list()). Engine `lib/studio.ts`, routes `/api/studio` (+ `/api/studio/media` serves bytes with escape guard). **Keys entered in Settings → "API Keys — Creative & Integrations"** (`components/ServiceKeysPanel.tsx` → `/api/services` → **`data/services.json`**, git-ignored; `.env.local` `OPENAI_API_KEY`/`ELEVENLABS_API_KEY`/`REPLICATE_API_TOKEN` used as fallback). Store abstraction `lib/services.ts` (catalog + `getServiceKey`/`hasServiceKey`, never leaks keys — GET returns `configured`/`source` only). No key → each tab shows a "🔑 Add a key in Settings" CTA + red orb; costs estimated into the usage ledger. Verified E2E: no-key path, bad-key 401 surfaced cleanly, store/clear round-trip, UI CTA↔composer swap. **NO real keys entered yet — user must add them in Settings to activate.** |
| server.cmd | prepends `.local\bin` / npm-global / Ollama to PATH (v19.1) — a boot-time PATH once missed the Claude native install and the bridge showed red; if an agent is red but its CLI works in a terminal, suspect server-process PATH |

## Codebase conventions & gotchas

- **`data/*.json` files are the source of truth** — never module-cache them (instrumentation
  and route bundles are separate module instances). Missions use per-mission read-modify-write.
- **Never cache a failed probe permanently** (cold-boot CLIs time out; failures get 60s TTL).
- `ACCENTS.base` is a CSS var — never string-concat alpha onto it (use `.border/.soft/.glow`);
  SVG colors from ACCENTS go via `style={}`, not presentation attributes.
- Theme = `data-theme` on `<html>` (boot script in layout; `suppressHydrationWarning` there is intentional).
- **When adding features, update `lib/guideContent.ts`** (the in-app manual + daily vault export).
- OS verbs (`<remember>` `<goal>` `<journal>` `<mission>`) harvest from chats only; mission
  outputs are never harvested (anti-recursion). `<mission>` goes through the approvals gate.
- Watch for a stray NBSP (U+00A0) if exact-match editing fails in ChatThread.tsx.
- One `.env.local` reference table lives in the Guide's "Settings & Environment Reference".

## Open roadmap / next candidates

1. **Studio activation** — enter real keys in Settings → API Keys (OpenAI covers image+voice; ElevenLabs for premium voice; Replicate for video), then generate a first asset per medium to confirm live paths. Only the no-key/bad-key paths are proven so far.
2. **Phase 3 (SEO publishing pipeline)** — the remaining deferred studio phase (Studio Phase 2 shipped in v23)
3. **Phone access** (Tailscale + PWA) — the older deferred roadmap item
4. **LLM-history import**: distill Idris's ChatGPT/Claude.ai chat exports into topic notes in the vault (pipeline designed 2026-07-12 — waiting on Idris to download the export ZIPs to `Documents\llm-exports`)
5. Optional: Gemini chat agent (free key at aistudio.google.com; embeddings already local); Hermes on the laptop
6. Keep feeding the Arena easy-tier battles so simple routing gets cheaper/smarter

## Suggested first message for the new session

> Read NEXT-SESSION.md in mission-control. Check the fleet is green (`/api/system`,
> `/api/agents`), then: [your goal for the session]
