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

## Fleet & config state (as of 2026-07-10 evening)

| Piece | State |
| --- | --- |
| Claude CLI | authed (interactive `/login` done); bridge strips `CLAUDE_*`/`ANTHROPIC_*` env except `ANTHROPIC_API_KEY` |
| OpenClaw | gateway = Windows Scheduled Task; Telegram bot **@IdrisGV75_bot** paired (owner id 7284896916); approval protocol lives in `~/.openclaw/workspace/TOOLS.md` — **update it if the API port/paths change** |
| Hermes | Nous Hermes Agent v0.18.2, absolute path in `.env.local`, one-shot `-z {input}` |
| DeepSeek | real key in `data/registry.json`, working |
| Gemini / embeddings | **NOT configured** — free key at aistudio.google.com would enable both (EMBED_* vars in `.env.local` activate hybrid retrieval) |
| Ollama / Codex | **not installed**; recipes in the Guide; localhost LLM endpoints need no API key |
| Vault | `C:\Users\Admin\Documents\IdrisGV75\IdrisGV75` → app writes under `Agentic OS/` |
| Schedules | 📚 Vault Librarian (Sun 18:00), 🛠 Ops Tuner (Sun 19:00 → Telegram), test schedule (off) |

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

1. **Phone access** (Tailscale + PWA) — the one deferred roadmap item
2. Inline "edit API key" button in Settings (today: delete + re-add)
3. Usage over features: real Arena battles, name OpenClaw (it's asked twice),
   CommunityForce workspace + Monday status schedule, Gemini key + EMBED_* for semantic RAG
4. Ollama install → first free/offline fleet member; Codex CLI as a command agent

## Suggested first message for the new session

> Read NEXT-SESSION.md in mission-control. Check the fleet is green (`/api/system`,
> `/api/agents`), then: [your goal for the session]
