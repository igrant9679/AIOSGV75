# Mission Control — Session Handoff

> Give this file to Claude at the start of a new session:
> `Read C:\Users\Admin\Documents\mission-control\NEXT-SESSION.md and continue from there.`
> (Claude Code also has persistent memory of this project — this file is the fast lane and the backup.)

## What this is

**Mission Control** — Idris's local AI operating system at `C:\Users\Admin\Documents\mission-control`
(Next.js 16 + Tailwind v4 + Framer Motion). Built July 9–16, 2026, versions **v1 → v41**;
maintenance + provider work 2026-07-22 → 08-05 (head **`72d1b3d`**+).
Repo: **https://github.com/igrant9679/AIOSGV75** (main, PUBLIC, gh CLI authed as igrant9679).

It orchestrates a fleet of AI agents with an Obsidian vault as its brain:
chats · missions (MoA/pipeline/debate/arena) · schedules with Telegram delivery · watchers ·
approval gates (answerable from Telegram) · shared memory + vault-wide link-aware RAG ·
knowledge graph · smart routing (Auto) · analytics/evals/arena · **18 exportable reports** ·
Creative Studio · SEO content pipeline → WordPress/Ghost/Webflow · **imported ChatGPT+Claude
history (2,242 conversations distilled)** · voice in+out · light/dark ·
built-in searchable guide (`/guide`, also exported to the vault for agent RAG).

**Three machines**, all on the same vault (OneDrive): desktop `Admin` (PRIMARY, this one) ·
laptop `idris` · laptop `sabin`.

**Clustering is now ON (2026-08-02)** — it is no longer "off by default, each standalone":

| Host | Label | User | Role | State |
| --- | --- | --- | --- | --- |
| `IdrisLegion7` | IdrisLegion7 | sabin | **primary** | **MASTER** (moved 2026-08-05 — desktop "too slow") |
| `DESKTOP-K82OGAE` | IdrisAsusGV75 | Admin | backup | holds the **Telegram gateway** |
| `WIN-C2ANEVBHN6Q` | IdrisMSIRaider18 | idris | workstation | back online 2026-08-05 after ~48h down |

⚠ **All three labels start with "Idris"** — the only unambiguous identifier is the install path
(`C:\Users\sabin\…` vs `C:\Users\Admin\…` vs `C:\Users\idris\…`). A role got set on the wrong
laptop this way; when the user says "sabine's machine" they mean **IdrisLegion7**.

Roles are **per-machine** in `data/cluster.json` (`process.cwd()/data`, NOT the vault) — only
`Cluster/lease.json` + `Cluster/nodes/*.json` are shared, so a role can only be changed **on that
machine** (Settings → Machine Group & Roles, or POST `/api/cluster` `{action:"config",role:…}`).
**The gateway no longer has to be the master** (as of `72d1b3d`) — approvals are vault-backed, so
the gateway stays on the always-on desktop while the faster laptop runs as master. Any earlier note
saying "keep the gateway on the master" is obsolete.

## Running state

- **Prod server auto-starts at Windows login** (`Mission Control Server.vbs` in Startup →
  `server.cmd` → `npm start -- -H 127.0.0.1`, port 3000, localhost-only).
- Desktop shortcut "Mission Control" opens it. `stop.cmd` kills it.
- **Dev cycle rule:** run `stop.cmd` BEFORE `npm run dev` (port conflict); after code changes
  run `npm run build` then restart via the VBS so the boot server serves the new code.
  If dev serves stale CSS/JS after big edits: `rm -rf .next/dev` and restart dev.

## Fleet & config state (rows dated; billing audit + machines current as of 2026-07-16)

| Piece | State |
| --- | --- |
| Claude CLI | authed (interactive `/login` done); bridge strips `CLAUDE_*`/`ANTHROPIC_*` env except `ANTHROPIC_API_KEY` |
| OpenClaw | **named Talos** (IDENTITY.md); gateway = Windows Scheduled Task; Telegram bot **@IdrisGV75_bot** paired (owner id 7284896916); approval protocol lives in `~/.openclaw/workspace/TOOLS.md` — **update it if the API port/paths change** |
| Hermes | Nous Hermes Agent v0.18.2, absolute path in `.env.local`, one-shot `-z {input}`. **Config is `%LOCALAPPDATA%\hermes\config.yaml` — NOT `~/.hermes/config.yaml`** (that path does not exist; older rows here were wrong). Desktop chain (2026-07-22): primary **`tencent/hy3:free`** ($0), fallback **`z-ai/glm-5.2`**. Fallbacks live in a top-level `fallback_providers:` LIST (`{provider,model,base_url?,api_mode?}`); the commented `fallback_model:` singular in the file is legacy. `hermes fallback add` needs a TTY, so script it by editing the YAML directly — and note **`hermes config set` rewrites the file and strips all trailing comment blocks** (edit by hand to keep them). Backups: `config.yaml.bak-preGlm`, `.bak-preSwap` |
| **Nous Portal ≠ flat-rate** | Hermes AUTHENTICATES via a Nous subscription (OAuth, auto-refresh), but inference is **metered per token against prepaid credits**. `/v1/models` returns 257 models WITH pricing — `tencent/hy3:free` is the only genuinely $0 one (`"pricing":{"prompt":"0"}`), which is why it's the primary. GLM 5.2 ($0.90/$2.83 per M) and Sakana Fugu are reachable here too, so **roadmap #3's premise was wrong** — they were never un-wired, just metered. ⚠ Nous bearer tokens are JWTs with `expires_in: 3599` → **cannot** be pasted into `data/registry.json` as an MC agent (works 1h, then 401). Hermes refreshes them itself |
| Telegram transport (**2026-08-02, `fb578ec`**) | `sendTelegram()` now posts to the **Bot API directly when `TELEGRAM_BOT_TOKEN` is set**; falls back to spawning `openclaw` when it isn't. **Why:** schedules/watchers/nudges are gated `if (!isMaster) return` in `scheduler.ts`, so the MASTER sends — and when the master was sabin (no OpenClaw), every scheduled notification vanished **silently** (spawn failed → `false` → run still marked successful). Chunks at 4096 chars (Bot API hard limit; mission reports exceed it), no `parse_mode` (stray `*` would 400 the message), and every failure path now logs. Sending over HTTP does **not** clash with the gateway — the single-consumer limit is on `getUpdates` polling |
| ✅ Telegram RECEIVE — SOLVED 2026-08-05 (`72d1b3d`) | Approvals moved from per-machine `data/approvals.json` into the **shared vault** at `Agentic OS/Approvals.json` (same pattern as vault-backed `Tasks.md`). Any machine can raise or answer one; `syncApprovedMissions()` on the MASTER's tick launches the mission, so work lands with the other background duties rather than on whichever laptop answered Telegram. The API route launches immediately when the resolver IS the master, so dashboard approvals still feel instant. **Proven end-to-end**: raised + approved on the desktop (a backup) → sabin (master) stamped `launchedAt` ~60s later, ran it, and archived `2026-08-05 16-56 via-cross-machine-test-approved…` to the vault with Claude's reply. Gotchas baked in: `save()` MERGES by id (several machines write over OneDrive); resolution and `launchedAt` are both one-way so a stale copy can't un-resolve or re-launch; migration stamps `launchedAt` on legacy approved rows (they predate the field — a **July mission was one tick from re-firing**); and a 1h launch window stops any restored backup resurrecting old missions |
| DeepSeek | real key in `data/registry.json`, working — but **unused → $0 actual** |
| **OpenRouter (new agent, 2026-07-31)** | ADDED and verified end-to-end: model **`nvidia/nemotron-3-super-120b-a12b:free`**, key in `data/registry.json`. Live test through `/api/llm` streamed deltas AND completed a full tool round-trip (`search_vault "qlik"` → vault hit → answer), usage frame reported **`"cost": 0`**. Free tiers are rate-limited, not unlimited |
| New provider presets (`lib/providers.ts`) | **Sakana Fugu** (`33cac0e`) — `https://api.sakana.ai/v1`, `fugu-ultra`, key from console.sakana.ai. **Kimi for Coding** (`215381c`) — `https://api.kimi.com/coding/v1`, `kimi-for-coding`, key from the **Kimi Code console**, flat-rate weekly quota (verified OpenAI-shaped: unauthenticated POST returns 401 in an OpenAI error envelope, not 404). **NEITHER HAS A KEY ENTERED — both are inert until you add one.** Moonshot sells three separate things: the coding plan (flat-rate, above), `api.moonshot.ai` (pay-per-token, preset `kimi`), and the consumer chat plan (**no API at all — cannot be connected**) |
| Auto cost ranks (`lib/router.ts`, `71fbc1a`) | `COST_RANK` is keyed by PROVIDER, which prices the vendor not the model. `costRankFor()` now overrides it: **localhost → 0** and **model id ending `:free` → 0**. Both previously hit the `?? 6` default, so Auto sent cheap work to **paid DeepSeek (2)** while free local Llama sat at 6 — `ollama` was never a key in the table at all. Sakana is pinned at **10** (above Claude's 9): $5/$30 per M, the dearest thing in this fleet (though only #16 of 257 on Nous — `gpt-5.5-pro` is $180/M out). Kimi-for-coding is **1** (flat-rate = free at the margin) |
| Llama (Ollama) | **installed** — Ollama 0.31.2, llama3.2 (tools-capable) + nomic-embed-text pulled; registered keyless at `http://localhost:11434/v1`; Ollama auto-starts (Startup folder) |
| Semantic RAG | **ACTIVE** via local embeddings — `EMBED_BASE_URL=http://localhost:11434/v1`, `EMBED_MODEL=nomic-embed-text` in `.env.local` (keyless). Gemini key now optional (only for a Gemini chat agent; recipe commented in `.env.local`) |
| Codex | CLI 0.144.1 **authed (ChatGPT login) + verified end-to-end** (mission answered 2026-07-11); template `codex exec --skip-git-repo-check {input}` — the flag is required (app spawns from a non-repo cwd) |
| Vault | **moved 2026-07-12 into OneDrive (LSI Media LLC)**: `C:\Users\Admin\LSI Media LLC\Working Files Idris - Documents\AI Mission Control\IdrisGV75` (VAULT_DIR in `.env.local`; pinned "always keep on this device") → app writes under `Agentic OS/` |
| Schedules | 📚 Vault Librarian (Sun 18:00), 🛠 Ops Tuner (Sun 19:00 → Telegram), 📊 **CommunityForce Monday Status (Mon 08:30 → Telegram)**, test schedule (off) |
| Workspaces | Default, Work, **CommunityForce** |
| Arena standings (2026-07-13) | Claude 3/3 · DeepSeek 2/5 · Hermes 1/3 · Llama 0/4 — hard tier has a champion, simple tier has evidence (DeepSeek/Hermes wins on easy battles). Battle lessons live in the Guide's Arena section |
| Laptop (user `idris`, host `WIN-C2ANEVBHN6Q`) | **deployed 2026-07-12 as WORKSTATION** — vault via OneDrive, Claude + Ollama installed, Talos/Hermes stay desktop-only, schedules empty. Cluster role **workstation** (can never be master). **⚠ Its server has been DOWN since ~2026-07-31** (heartbeat stale ~41h at time of writing) — updated but `server.cmd` never came back. Harmless as a workstation, but check it |
| Laptop 2 (user `sabin`, host `IdrisLegion7`) | **deployed 2026-07-14 via install.ps1** — THIRD machine (don't assume "laptop" = idris). Hermes installed + dashboard built (one-time `hermes dashboard --no-open` build; `--skip-build` auto-start works after), `HERMES_BIN/CMD` set with the **sabin** path. Talos stays desktop-only. Cluster role **backup**. Updated to `71fbc1a` on 2026-08-02. **Still needs: `TELEGRAM_BOT_TOKEN` in `.env.local` (otherwise failing over to it silently loses all notifications), a pull to `fb578ec`, and its Hermes is still on GLM 5.2 (metered) rather than free hy3** |
| Settings | **full inline LLM editing** (v19.1) — pencil opens all fields: name/provider/baseUrl/model/key/prompt/accent; blank key keeps current, REMOVE KEY checkbox for keyless localhost |
| Ops pages (v20) | **/tasks** kanban (vault-backed: `Agentic OS/Tasks.md`, syncs across machines, hand-edits adopted), **/schedule** cron calendar (7-day timeline over schedules+watchers), **/library** vault content browser (/api/vault/notes); Overview adds disk/data-store vitals, Ops Pulse tiles, 7-day Fleet Activity |
| Graph (v20.2) | **/graph** knowledge-graph visualization — canvas force sim over /api/vault/graph (notes=nodes, wikilinks=edges), folder legend/filter, hover neighborhoods, click→Obsidian, orphan/hub stats; loop sleeps when settled, timer fallback drives it in hidden tabs (rAF is suspended there) |
| Orchestrator (v21) | **Tasks page panel**: goal → Claude plans ≤5 subtasks → each dispatched to **auto** (cost routing) **or pinned workers** (v21.1: pick ≤4 agents in the launcher, subtasks round-robin — how to leverage Hermes deliberately) → Claude reviews, ≤2 reworks w/ feedback → Claude assembles; vault archive + Telegram + kanban lifecycle (🤖 task; failure → back to Pending). lib/orchestrator.ts, data/orchestrations.json, ≤2 concurrent |
| Needs Attention (v21) | **Overview panel** + /api/attention: pending approvals w/ age, failed missions (24h), stalled runs (>10m), failed schedules; scheduler tick sends one ⏳ Telegram nudge per approval pending >10m (data/attention-nudges.json) |
| Studio suite (v22 · Phase 1 from Julian Goldie's "Agentic OS" screenshots) | **⌘K palette** (Shell), **/mastermind** (fleet group chat, sequential round-robin so agents riff, @-mentions, data/mastermind.json), **/builds** (Claude builds single-file HTML games/apps → vault Agentic OS/Builds/, sandboxed iframe play), **/hermes-lab** (Goal Mode: `hermes chat --yolo --max-turns N` in scratch dir w/ live log tail + Telegram; Control Room: iframe of `hermes dashboard` @127.0.0.1:9119), **/watcher** (keyless YouTube RSS trend radar, recency+keyword+views scoring, AI titles/angles, 4h rescan on scheduler, vault-logged) |
| Studio suite cont. (v22.1) | **/pipeline** (Inbox→Shipped: capture→Claude classifies type/confidence/tags→small items auto-file, projects wait at human gate→approve launches Orchestration→shipped; lib/pipeline.ts reuses orchestrator, syncExecuting on scheduler tick), **/jarvis** (voice command center: Web Speech listen→navigate "go to X" or ask Auto agent→speaks back; wake word + voice picker + typed fallback). Coverage map artifact: https://claude.ai/code/artifact/0b75aba6-1bfe-4187-a40d-37a0056f459d |
| Creative Studio (v23 · Phase 2) | **/studio** — image · voice · video from prompts via paid APIs, outputs saved to vault `Agentic OS/Studio/{images,audio,video}/`. Image = OpenAI gpt-image-1/DALL·E 3 **or Google Gemini 2.5 Flash Image** (v23.1; aspect-ratio selector in v24, b64→png); Voice = OpenAI TTS or ElevenLabs (mp3); Video = Replicate predictions (async, polled forward on every list()). Engine `lib/studio.ts`, routes `/api/studio` (+ `/api/studio/media` serves bytes with escape guard). **Keys entered in Settings → "API Keys — Creative & Integrations"** (`components/ServiceKeysPanel.tsx` → `/api/services` → **`data/services.json`**, git-ignored; `.env.local` `OPENAI_API_KEY`/`GEMINI_API_KEY`/`ELEVENLABS_API_KEY`/`REPLICATE_API_TOKEN` used as fallback). Store abstraction `lib/services.ts` (catalog + `getServiceKey`/`hasServiceKey`, never leaks keys — GET returns `configured`/`source` only). No key → each tab shows a "🔑 Add a key in Settings" CTA + red orb; costs estimated into the usage ledger. Verified E2E: no-key path, bad-key 401/400 surfaced cleanly, store/clear round-trip, UI CTA↔composer swap. **NO real keys entered yet — user must add them in Settings to activate.** |
| Conversations search + color + companions (v29) | **/conversations** — search every chat across all agents by topic/keyword. `lib/conversations.ts` parses vault `Agentic OS/Chats/*.md` into exchanges (splits on `### time · [[agent]]` headings, extracts agent/date/time/host/title=first-user-line/user+assistant text), scored keyword search + facets by agent/machine/date; `/api/conversations` GET(q/agent/host/date). `components/ConversationsSection.tsx` (debounced search, agent+machine filter chips w/ counts, highlighted snippets, expand→full Markdown + Open-in-Obsidian). **Machine tagging**: `appendChatLog` now injects `· 🖥 <os.hostname()>` into each exchange heading (old chats show "unknown"). Verified: 17 exchanges parsed from 2 files, facets correct, keyword search scored. **Color refresh**: Header logo = animated conic-glow + cyan→indigo→magenta gradient badge w/ radar SVG; title "MISSION CONTROL" = 4-stop gradient (bg-clip-text, theme-var colors); nebula boosted 3→5 radial layers (added amber+lime) both themes. **Companion checklist** added to in-app guide + install methods confirmed (OpenClaw=`npm i -g openclaw`; Hermes=git install → `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`). |
| Full Windows installer (v28) | **`install.ps1`** + **`install.cmd`** — one-shot bootstrap: winget-installs Git / Node LTS / Ollama, clones-or-pulls the repo, `npm install` + build, pulls llama3.2 + nomic-embed-text, installs Claude Code (native `irm https://claude.ai/install.ps1`) + optional Codex (`npm i -g @openai/codex`), writes a starter `.env.local` (prompts VAULT_DIR), installs the hidden auto-start VBS, and prints the un-automatable steps (claude /login, vault/OneDrive, Studio+WordPress keys, Hermes/OpenClaw). Idempotent; `-DryRun`/`-Yes`/`-SkipModels`/`-InstallCodex`/`-RepoDir`/`-Vault` flags; self-locates if run inside a clone. Repo is PUBLIC so the raw-URL bootstrap one-liner + `git clone` need no auth. Verified: syntax parse-checked + `-DryRun` on the desktop correctly detected all prereqs and made no changes. SETUP-NEW-MACHINE.md "Quick install" section + guide updated. |
| Machine group & failover (v27) | `lib/cluster.ts` — leader election across machines that share only the vault (OneDrive). Each node heartbeats `Agentic OS/Cluster/nodes/<host>.json`; the master holds a renewable lease (`Cluster/lease.json`, TTL 6min, renewed every 30s tick). Roles: **primary** (preferred master), **backup** (claims the expired lease if the primary dies; defers to a live primary), **workstation** (never). `clusterTick()` gates the scheduler's master-only duties (schedules/watchers/nudges/rescan/pipeline-sync/scaffold) — **off by default → returns true → lone machine runs as always**. Also the answer to "specify the install folder": per-machine `installDir` setting (default process.cwd()), shared in the heartbeat. `/api/cluster` (GET status, POST config/claim/release/forget). Settings → **Machine Group & Roles** panel (`components/ClusterPanel.tsx`): enable toggle, role, install folder, display name, live member list (online/master badges), make-master/step-down. Eventually-consistent (OneDrive) → failover in minutes; brief overlap possible. Caveat: backup runs schedules/watchers but Telegram(OpenClaw)/Hermes only work where installed. Verified E2E on the desktop: standalone default, enable-as-primary→master, **injected dead primary → backup took over**, **live primary → backup deferred**, then reset to standalone (cluster files + config removed). Also v26.1: `install-service.cmd` portable auto-start installer. |
| Local Services supervisor (v26) | `lib/daemons.ts` — checks/starts companion daemons the app needs: **Hermes dashboard** (port 9119, spawned `hermes dashboard --skip-build --no-open` — the plain command rebuilds its web UI and HANGS in a background spawn; --skip-build serves the prebuilt dist, up in ~4s) and **Ollama** (11434). `ensureDaemons()` wired into `instrumentation.ts` boot → since the app auto-starts at login, companion services come up on every system restart. `/api/daemons` (GET status, POST {id} start). **Local Services** panel (`components/DaemonsPanel.tsx`) on the Hermes Lab page + a "Start dashboard" button in the Control Room "not running" state. Verified: dashboard started via API, 9119 up, Control Room iframe loads. **`update.cmd`** added (git pull → npm install → npm run build → restart) = the one-click updater for other machines. |
| History Import (v25) | **/import** — ingest ChatGPT + Claude data exports → distill into vault topic notes. `lib/llmImport.ts`: scans `LLM_EXPORTS_DIR` (default `Documents\llm-exports`, ZIPs auto-extract via Expand-Archive on win32), parses BOTH formats (ChatGPT `mapping` tree + unix `create_time`; Claude `chat_messages` + ISO dates) deduped by id → metadata index `data/llm-import.json` (per-machine). **Two stages, cost opt-in:** SCAN (free/local, shows counts+date range) then DISTILL (bounded: writer + max-per-run; fleet condenses richest-first batches of 12 into `Agentic OS/History/Imported History <tag>.md` topic notes w/ a "Durable facts about owner" section; resumable via `processed` flags; stale-job detection). Routes `/api/import` (GET summary; POST scan/distill/reset). `components/ImportSection.tsx` (stats tiles, progress bar, sample list). Verified E2E: synthetic ChatGPT+Claude exports parsed (4 convos), **real Claude distill produced an excellent 4-topic digest + cross-conversation durable facts**, resumable "nothing new" path, cleaned up. Raw exports/index stay machine-local; only distilled notes hit the synced vault (RAG'd automatically). |
| Content Pipeline (v24 · Phase 3) | **/content** — keyword → fleet drafts an SEO article (title/meta/slug/secondary-kw/body/hero-prompt as JSON) → **local 9-point SEO score** (`scoreSeo`, no API) → saved to vault `Agentic OS/Content/<slug>.md` w/ YAML frontmatter. Engine `lib/content.ts` (`startDraft` fire-and-forget via `runAgentText`, `extractJson`, self-contained `mdToHtml`), routes `/api/content` (draft/hero/publish actions + `maxDuration=120`) + `/api/content/export?id=&format=md\|html`. **Hero image** reuses the Studio image engine (needs OpenAI/Gemini key). **Publish → WordPress** REST (`lib/publish.ts`, Application Password Basic auth, posts as **draft** by default), creds in **Settings → "Publishing — WordPress"** (`components/PublishingPanel.tsx` → `/api/publish` → **`data/publish.json`**, git-ignored; `WP_SITE`/`WP_USERNAME`/`WP_APP_PASSWORD` env fallback). No WP → export MD/HTML instead. Verified E2E: **real Claude draft scored 100/100, 868 words, saved to vault**; export HTML valid; no-creds + bad-site (405) publish errors surfaced cleanly; UI detail (checklist/hero/export/publish CTAs) all render. |
| Overview refresh (v31.2–.3) | header logo = animated orbital emblem (gradient ring + counter-rotating satellites + pulsing core, SVG w/ theme vars) + full-gradient shimmer wordmark (`.logo-title`); **v31.3: lockup is 2× (80px emblem / text-4xl title, responsive: h-14/text-2xl below md)**; Panel titles get a page-accent tick; **Ops Pulse** = glow tiles w/ live queue dots, 12-bucket today sparkline, integrity ring gauge (lime/amber/rose by ratio); Claude Mission Totals = same glow tiles; Needs Attention all-clear = pulse-ring check emblem "ALL SYSTEMS NOMINAL", items get orbs + accent wash; **light theme: panels = accent-tinted glass (color-mix of `--page-accent` at top), 6-layer pastel aurora nebula, stronger grid**. All colors via `--ac-*`/ACCENTS (both themes verified). Known pre-existing: SystemVitals gauges overflow <624px viewports (task chip filed) |
| Page identity + shared UI kit (v32) | **PageHero** in Shell (`ui/PageHero.tsx` + `ROUTE_META`/`metaForPath` in lib/accents.ts): every page opens with accent title + tagline + scanning hairline, dynamic `/agent/*` routes fall back to segment name. **`ui/GlowTile.tsx`** (extracted from Overview) + **`ui/EmptyState.tsx`** (radar-sweep empty state, `compact` variant). **Accent-scoping trick:** wrap any Panel in `<div style={{"--page-accent": ACCENTS[x].base}}>` and its top edge/title tick/hover glow all take that color — used on Tasks stat cards + kanban lanes (per-lane colors, count chips, hover-lift cards w/ left accent border) and Analytics headline stats (+ 14-day TrendSpark sparklines, gradient by-agent bars). Adopted EmptyState: Tasks lanes, Analytics by-agent, Overview fleet activity |
| Deck experience (v33) | **10-piece batch:** page-accent sky tint (`.page-tint` in Shell); footer = live event ticker (`ui/EventTicker.tsx`, click→source page); `?` shortcuts overlay (`ShortcutsOverlay.tsx`); confetti bursts (`ui/Celebration.tsx` — `celebrate(accent)` fired on task-done, mission running→done, arena crown; reduced-motion no-op, 2s hard stop); Avatar `busy` prop = pulsing ring (typing indicator, mission avatars, arena VS strip); **Missions** stage rails + `mission-running` amber breathe; **Schedule** accent stat cards + per-job countdown RingGauge + today row w/ time-of-day progress; **Arena** VS strip + top-3 podium; **Tasks** native HTML5 drag-and-drop between lanes (motion.div hijacks onDragStart — use plain div for DnD cards); **Analytics** month-end projection chip + dashed 7d-pace line (Bars `refValue`); EmptyState adopted across ~14 sections; `ui/RingGauge.tsx` extracted. Guide "Deck interactions" added |
| Remaining-pages widgets (v34) | **Pipeline**: Flow funnel panel (per-stage counts), stage panels accent-scoped w/ count chips, Human Gate breathes amber when items wait, celebrate on →shipped. **Journal**: 12-week WritingHeatmap (click day → open entry) + streak stat (today-not-yet-written doesn't break streak). **Content**: SEO score = RingGauge on each card. **Auto**: "Recent Routes" panel parsed from the chat's system lines ("→ agent · reason"). **JARVIS**: SVG arc-reactor rings (speed up while active; lime listening / magenta speaking), `.eq-bar` equalizer, tappable example-command chips. **Memory**: GlowTile stats + search EmptyState. EmptyStates: Watcher, HermesLab ×2, Settings LLM list |
| v35 (theme takeover · Ghost/Webflow · live EQ) | **Agent theme takeover**: Shell restructured — accent resolution + `--page-accent` now live in `DeckFrame` INSIDE MissionProvider (so `/agent/<id>` resolves its registry accent); `.theme-takeover` on agent chat routes (/auto /claude /openclaw /hermes /agent/*) crossfades `.nebula`→`.nebula-accent` (monochrome color-mix of `--page-accent`); PageHero switched to `var(--page-accent)`. **Publishing**: lib/publish.ts = 3 targets (`publishTo(target,post)`) — Ghost Admin API (hand-rolled HS256 JWT from `id:secret`, `?source=html`, status "published" not "publish") + Webflow CMS v2 (`isDraft`, fieldData name/slug/<bodyField>, NO page URL returned) + WP; store `data/publish.json` {wordpress,ghost,webflow}; env fallbacks GHOST_SITE/GHOST_ADMIN_API_KEY, WEBFLOW_TOKEN/COLLECTION_ID/BODY_FIELD; /api/publish POST{target,...}/DELETE?target=; PublishingPanel = 3 forms; ContentSection = per-target Push buttons; ContentItem.publishedTo. Ghost/Webflow untested vs real sites (no creds). **JARVIS LiveEqualizer**: getUserMedia→AnalyserNode (fftSize 128, smoothing .75), rAF writes bar heights directly (no React state), lower-half spectrum bins, falls back to CSS Equalizer on mic denial; used while listening, CSS version kept for TTS speaking |
| Reports (v37) | **/reports** — 18 exportable reports over the OS's data stores, 4 categories (Operations/Brain/Quality/Output incl. Executive Brief rollup, Fleet Performance, Cost & Spend w/ projection, Reliability, Model Mix, Automations, Conversation Insights, Topic Landscape, Brain Health graph stats, Memory audit, Import Coverage, Writing Rhythm, Mission Ops, Arena, Evals, Productivity, Pipeline Flow, Content & SEO). Engine `lib/reports.ts`: uniform `ReportData` {kpis, charts, tables, notes} per builder → ONE generic UI (`components/ReportsSection.tsx`) + ONE md serializer; builders resilient (missing store → zeros). Routes `/api/reports` (GET catalog/?id=, POST vault-save) + `/api/reports/export?id=&format=md\|html` (html = self-contained printable → PDF). Vault saves → `Agentic OS/Reports/` (**gotcha fixed: `vaultInfo().base` already includes "Agentic OS" — don't join it again**, first save doubled the dir). All 18 verified building + all 3 export paths verified live |
| Self-healing daemons + path hint (v38) | **`lib/daemons.ts`**: Daemon gained `fallbackArgs`/`fallbackNote`. Fast path stays `dashboard --skip-build --no-open` (~4s); if the port doesn't open, `startDaemon`/`ensureDaemons` automatically relaunch with `dashboard --no-open` (real UI build, minutes) — so a fresh install or a cleared build repairs ITSELF instead of needing a hand-run. `startDaemon` returns `{building:true}` (HTTP 202, not an error) and DaemonsPanel shows "building its web UI" + polls. Daemon stdout/stderr now go to **`data/<id>.log`** (was `stdio:"ignore"` — failures were invisible). **Offline-agent hint** (`offlineHint()` in the agents route → `AgentInfo.hint` → red box on the agent page): when a configured absolute path doesn't exist AND names a different `\Users\<name>` than `os.userInfo().username`, it says so plainly — this is the #1 cause of a red agent (a `.env.local` copied between machines) and "binary not found" used to send people reinstalling. Verified by simulating the bug on the desktop |
| History searchable in Conversations (v41) | `lib/conversations.ts` now indexes `Agentic OS/History/` alongside `Chats/`. **One record PER `## topic`** (not per note — a 12-conversation note is too coarse to search); Index hubs + `## Sources` skipped; frontmatter `date`/`tags` carried onto each record; `Exchange.kind: "chat"\|"history"` threaded through SearchItem/groupSessions/toItem. "Durable facts about the owner" repeats in all 187 notes → title suffixed w/ the run stamp so results are distinguishable. **`conversationAnalytics()` filters to kind==="chat"** — 1,513 history topics all stamped with the distill date would bury the real activity trend + break busiestDay. UI: violet avatar + IMPORTED badge + tag pills + "distilled <date>" instead of host/turns. Verified: 1,530 indexed (1,513 history + 17 chats), "qlik"→159 hits, "salesforce"→69. **This is what makes the import searchable on the laptops too** (vault-synced; raw exports + processed flags stay machine-local) |
| Billing honesty + retry (v40) | **`lib/billing.ts`** + `/api/billing`: `billingFor(agentId, llms)` → `subscription` (claude via OAuth — no ANTHROPIC_API_KEY) / `api` (registry LLM w/ remote baseUrl = REAL charges) / `local` (localhost = free) / `unknown` (command agents self-authenticate). **Why this exists: the Claude CLI reports `total_cost_usd` even on a subscription — it's an estimate at list prices, NOT a bill.** Analytics + Reports now split "API spend" (billed only; drives the month-end projection) from a violet "subscription usage — not billed" banner; per-agent rows tagged BILLED/SUBSCRIPTION/FREE; subscription costs render as `~$X est`. Desktop reality: API spend $0.00, 19 claude runs ≈$1.46 est. **Distill retry**: `isTransient()` + `BATCH_RETRIES=4` w/ 1m/5m/15m/30m backoff, heartbeating while paused — a rate-limited EVERYTHING run now waits out the window instead of dying; non-transient errors (bad writer, vault gone) fail fast; progress always saved + resumable. |
| **AUDITED FLEET BILLING (2026-07-16, openclaw updated same day)** | claude=**subscription** (OAuth idris.grant@gmail.com) · codex=**subscription** (ChatGPT login, `~/.codex/auth.json` tokens, no OPENAI_API_KEY) · hermes=**subscription** (Nous Portal OAuth, `config.yaml provider: nous`; supports zai/GLM+kimi+minimax as fallbacks — not configured) · **openclaw=SUBSCRIPTION as of 2026-07-16** (switched from Gemini API key → `google-gemini-cli/gemini-3.1-pro-preview` OAuth as idris.grant@gmail.com; see the row below) · deepseek=**API key** (real, but unused → $0) · llama=**local/free**. **Real API spend is now ≈ $0.** Still NOT configured despite user having subs: GLM 5.2, Sakana AI. ⚠ Telegram bot token was exposed in a config dump 2026-07-16 — CHECK IT WAS ROTATED |
| OpenClaw → Gemini subscription (2026-07-16) | OpenClaw ships **two** Google providers: `google` (API key, pay-per-token) and **`google-gemini-cli`** (OAuth `oauth-personal`, drives Google's own `@google/gemini-cli`, same `gemini-3.1-pro-preview` model). Switched via `openclaw models auth login --provider google-gemini-cli` (user does the browser sign-in) + `openclaw models set google-gemini-cli/gemini-3.1-pro-preview`. **The `gemini` alias also had to be repointed** (`models aliases add gemini google-gemini-cli/...`) or it silently kept using the API key. **REQUIRED OpenClaw ≥ 2026.7.1**: 2026.6.11 spawned the CLI without `shell:true` → on Windows npm installs `gemini.cmd`, Node's spawn only resolves `.exe` → `spawn gemini ENOENT`. Proven in isolation: `spawn('gemini')`=ENOENT, `spawn('gemini',{shell:true})`=works, `spawn('gemini.cmd')`=EINVAL (Node≥20 blocks .cmd without shell). Verified live after the update: Talos replied "SUBSCRIPTION OK", `models status` shows `oauth=1, api_key=0` for the active provider. `google:default` api_key profile REMAINS — it still powers the web-search plugin (separate from the model). Fallbacks are empty ON PURPOSE: adding one back to `google/*` would silently resume billing when the subscription rate-limits. Config backup: `~/.openclaw/openclaw.json.bak-preGeminiSub` |
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
- **Adding an LLM provider preset = 3 files:** `lib/providers.ts` (the preset), `lib/router.ts`
  (a `COST_RANK` entry — the `?? 6` default mis-prices anything genuinely cheap or dear), and
  `lib/guideContent.ts` (rule 5). Skipping the router entry is the easy one to miss.
- **`app/api/llm` + `lib/runners.ts` send only `model`/`messages`/`stream`(+`tools`)** — no
  `temperature`/`max_tokens`/`top_p`. That's why providers with narrow parameter support (Sakana
  Fugu) drop in unchanged. There's also a transparent one-shot retry without `tools` if a
  provider 4xxs mentioning them.
- **`billingFor()` marks any remote-baseUrl registry LLM as `api` (= billed).** That's wrong for
  flat-rate endpoints like Kimi-for-Coding. Harmless today — the LLM route records token counts,
  not `costUsd`, so no fabricated dollars appear — but the per-agent tag reads BILLED. Fix only
  if the Analytics split starts mattering.

## ⚠ OPEN — read first (2026-08-05)

1. **`TELEGRAM_BOT_TOKEN` on sabin — UNVERIFIED and now load-bearing.** Sabin is the MASTER as of
   2026-08-05, and the master is what sends. It has no OpenClaw, so without that one line in its
   `.env.local` **every scheduled notification fails silently** — 🗞 Chief of Staff (weekdays 08:00)
   and 🛠 Ops Tuner (Sun 19:00) included; the send returns false and the run still records success.
   Idris was told twice; not confirmed either time. **Check this first** — it is the only remaining
   silent-failure path in the fleet. (Worth setting on the desktop too, so sends don't depend on
   OpenClaw's health.)
2. **Sabin's Hermes may still be on metered GLM 5.2.** The desktop runs `tencent/hy3:free` primary
   with `z-ai/glm-5.2` as fallback; sabin was set to GLM 5.2 *primary* and the swap was never
   confirmed, so it may be spending prepaid Nous credits on every call. Easiest check/fix is now
   the UI: **/hermes-lab → Model & Fallback** (per-machine, so it must be done ON sabin), or
   `hermes fallback list` there.
3. **Telegram bot token was exposed 2026-07-16 and was NEVER rotated.** Verified still live on
   2026-07-22 (`getMe` → ok, @IdrisGV75_bot, id 8893333281) and confirmed unchanged: every
   `openclaw.json` backup going back to 07-09 carries the identical token fingerprint
   (sha256 `23d80fec…`). **Idris explicitly deprioritised this ("don't worry about token")** —
   do not re-litigate it unsolicited, just don't assume it's fixed. Rotation = @BotFather
   `/revoke` → update `openclaw.json` → restart gateway. Note the token now also matters for
   `TELEGRAM_BOT_TOKEN` (item 1), so rotating means updating both places. Lesson that produced
   the leak: when dumping any config, redact by *value shape* (long random strings), not by a
   key allowlist — and prefer comparing sha256 prefixes over printing values.
4. **Sakana + Kimi-for-Coding presets still have no key** (inert; keys are per-machine).
   ✅ **GLM is LIVE and proven 2026-08-06** — agent id `glm`, provider `glm-coding`,
   `https://api.z.ai/api/coding/paas/v4`, model `glm-5.2`, on the **GLM Coding Pro** plan
   ($64.80/mo, 5× Lite ≈ 400 prompts/5h, auto-renews 2026-09-03). Verified streaming AND a real
   `search_vault` tool round-trip. **The trap fired for real:** it was first added against
   `/api/paas/v4` and every call returned `429 code 1113 "Insufficient balance"` — the Coding Plan
   does NOT fund the metered endpoint, and the SAME key worked immediately once the base URL was
   switched. A 429/1113 on z.ai means wrong endpoint, not a bad key. Auto now ranks it **1**
   (flat-rate) alongside kimi-coding/gemini, behind only the free agents.
5. **Studio + Content still un-activated** — no real API keys entered (see roadmap #1).
6. **Every machine that can become master needs to be UP TO DATE.** Sabin ran as master for a
   while on code that predated both the Telegram transport and vault-backed approvals. A stale
   master is the whole fleet's behaviour — `.\update.cmd` after anything lands.

### Recently fixed, worth not re-breaking
- **`findstr ":3000 "` matched IPv6 addresses containing `:3000` (fixed 2026-08-02, `dfcdd3e`).**
  findstr splits its pattern on the space and treats the parts as an **OR-list**, so
  `[fddb:ee5:df6d:1:982f:3000:a178:2e66]:62546 … LISTENING 4140` matched — a stranger's socket on
  port 62546. Consequences: `server.cmd`/`launch.cmd`'s "already running?" guard fired and did
  `exit /b`, so **the server silently refused to start — no error, no window, nothing logged**,
  striking at random because Windows IPv6 privacy addresses rotate. `update.cmd` was worse: it
  took `tokens=5` off that line and `taskkill /f`ed it — an unrelated pid (on this desktop, pid
  4140 was **DeskIn, a remote-desktop agent**, so updating a laptop over remote access would have
  killed the session). Fix: `/C:` makes the space part of one literal pattern; `update.cmd` now
  asks Windows for the port owner (`Get-NetTCPConnection`) the way `stop.cmd` always did.
  **If a server ever "just doesn't come up" with zero output, suspect a guard like this first.**
- **Don't run `update.cmd` when the pull rewrites `update.cmd` itself.** `cmd.exe` reads a batch
  file incrementally by BYTE OFFSET and re-reads after each command, so replacing it mid-run
  resumes at a meaningless position (partial line / skipped / repeated). When a pull touches
  `update.cmd`, hand-run the steps instead: `.\stop.cmd` → `git pull` → `npm install` →
  `npm run build` → `Start-Process .\server.cmd -WindowStyle Hidden`.
- `install-service.cmd` takes an optional folder (v31.1): **argument** → script's own folder →
  **interactive prompt**; refuses a folder with no `server.cmd`. (cmd trap: `set "VAR=%VAR:"=%"`
  unbalances quotes → ". was unexpected at this time"; use `set VAR=%VAR:"=%`, no outer quotes.)
  Healthy VBS = 2 lines: `Set sh = CreateObject("WScript.Shell")` / `sh.Run """<repo>\server.cmd""", 0, False`
- The "emptied .vbs" scare (2026-07-14) was a **false alarm** — file was intact all along. Don't re-hunt it.

## ✅ DONE 2026-08-02 → 08-05 — user profile, vault-backed approvals, GLM subscription

Commits: `d40b255` profile engine · `3eebb33` weekly refresh + Settings panel · `c640e03`
memory-as-source · `ff4fc47` cap 1500 · `e99033d` guide · `186cb6f` GLM Coding Plan preset ·
`72d1b3d` **vault-backed approvals**.

- **User Profile** (`lib/userProfile.ts`, Settings panel, `/api/profile`) — a maintained "who you
  are working with" note distilled from **memory + chats + goals + tasks + journal**, injected
  WHOLE into every agent via `memorySystemBlock()`. Rewritten (not appended) weekly on the master;
  capped 1500 chars with a compression pass before any cutting. Memory.md is fed in FIRST and
  marked authoritative — without it the profile kept resurrecting a corrected fact out of an old
  chat log. This is the deliberate alternative to Honcho/mem0 (Hermes-only providers that bill an
  LLM call every couple of turns); see the guide's "User Profile" section for the reasoning.
- **GLM Coding Plan preset** — z.ai has TWO OpenAI endpoints that are NOT interchangeable:
  `/api/coding/paas/v4` (flat-rate subscription) vs `/api/paas/v4` (metered). Hermes's built-in
  `zai` provider hardcodes the metered one, so the subscription belongs in Settings, not Hermes.
- **Vault-backed approvals** — see the Telegram RECEIVE row. Proven cross-machine.
- **RapidApplications** — the CMS was renamed off "CommunityForce" on 2026-07-01; a stale memory
  fact was corrected, a sourced `Workspaces/CommunityForce/Project Overview.md` written from the
  GitHub API, and the Monday schedule's prompt rebuilt (it had been TIMING OUT at 300s because it
  told Claude to search a vault that now holds 108 imported notes mentioning the project).

## ✅ DONE 2026-07-22 → 08-02 — providers, cluster roles, two silent-failure bugs

Commits on `main` (all pushed): `33cac0e` Sakana preset · `215381c` Kimi-for-Coding preset ·
`dfcdd3e` **findstr/taskkill fix** · `71fbc1a` free-model cost ranks · `fb578ec` **Telegram Bot
API transport**.

- **Hermes** moved off metered GLM 5.2 back to free `tencent/hy3:free` (desktop), GLM demoted to
  fallback. Confirmed live: the model answered "Tencent Hunyuan 3 free model".
- **OpenRouter added and fully proven** — streaming + a real `search_vault` tool round-trip,
  `cost: 0`.
- **Cluster turned on across all three machines**, master moved desktop → sabin → back to desktop
  (deliberate: Telegram send AND approval-receive both live where OpenClaw is).
- **Two silent-failure classes killed:** the `findstr` IPv6 guard (server refusing to start with
  zero output; `update.cmd` force-killing an unrelated pid) and Telegram sends vanishing on a
  master without OpenClaw.
- Billing picture: **real API spend ≈ $0**. Claude/Codex/OpenClaw/Hermes are subscriptions,
  Llama + OpenRouter are free, DeepSeek's key is configured but unused. The one caveat is that
  Nous inference is metered prepaid credits, so Hermes only costs $0 while it stays on `:free`.

## ✅ DONE 2026-07-16 — LLM history import (was roadmap #2 for weeks)

**2,242 conversations distilled → 187 notes + 2 index hubs in `Agentic OS/History/`.**
Claude writer, ~2.5h, 0 failures, 255 duplicates auto-removed, 865 distinct tags, range
2023-07-16 → 2026-07-14. Cost **nothing** (subscription, see billing row). Now searchable in
Conversations (1,530 records) on **every** machine, clustered in `/graph` (189 nodes, 0 orphans).
Top themes: communityforce(45) · power-apps(29) · lsi-media(27) · enterprise-architecture(23) ·
saf-ia(22) · n8n-automation(18) · federal-contracting(16) · qlik-sense(15).

Raw exports (675MB, 212 files) + `data/llm-import.json` stay in `Documents\llm-exports` on the
DESKTOP ONLY — never import on another machine (processed flags are per-machine → duplicates).

## Open roadmap / next candidates

1. **Studio + Content activation** — the last big un-activated feature. Enter real keys: Studio (OpenAI = image+voice; Gemini/ElevenLabs/Replicate) **and** a publish target (Settings → Publishing now has WordPress **+ Ghost + Webflow**, v35). Only no-key/bad-key paths are proven; a real Claude draft (100/100 SEO) confirmed the content half works. **Ghost/Webflow are untested against real sites** — first live push deserves a watch.
2. **Phone access** (Tailscale + PWA) — long-deferred. Note `/` still overflows below ~624px (SystemVitals gauges); a task chip was filed for it.
3. ~~**Configure the remaining idle subscriptions**~~ — **largely resolved / premise corrected 2026-07-22.** GLM 5.2 and Sakana were never "un-wired": both are reachable through Hermes's existing Nous Portal login, just **metered per token**, which is why they're fallbacks and not primaries. GLM 5.2 IS now Hermes's fallback on the desktop. Still genuinely un-wired: a **direct Z.ai subscription** (Hermes `zai` provider, `GLM_API_KEY` — canonical; `ZAI_API_KEY`/`Z_AI_API_KEY` are accepted aliases, but `status.py` only checks the canonical one so an alias shows ✗). ~~OpenClaw on a Gemini API key~~ **DONE 2026-07-16**.
   ⚠ **If wiring Kimi through Hermes, override `base_url`** — Hermes's built-in `kimi-coding` provider hardcodes the METERED `https://api.moonshot.ai/v1`, so the coding-plan key would silently bill per token.
4. Content niceties: hero image → WP media library + embed; bulk keyword → article runs.
5. Keep feeding the Arena easy-tier battles so simple routing gets cheaper/smarter.
6. Deferred (Idris held off 2026-07-14): **named cluster groups** — `group` field in cluster config + `Cluster/<group>/…` namespacing + a Group-name field in the Machine Group panel, for multiple failover groups sharing ONE vault. Not needed today: separate groups = separate vaults (VAULT_DIR), which also separates the brain — that's the current answer to "start a new Group".
7. Optional: re-distill the richest ~100 conversations at higher quality, or feed `/import`'s ChatGPT half (only Claude exports were present this run — `sources: {claude: 2242}`).
8. ~~**Telegram approvals across machines**~~ — **DONE 2026-08-05** (`72d1b3d`), see the Telegram RECEIVE row. The gateway and the master are now independent.
9. **Prove Sakana / Kimi-for-Coding end-to-end** once keys exist. Both presets are verified only up to the network boundary — for Kimi that's an unauthenticated 401 in an OpenAI-shaped envelope. OpenRouter is the one that's been fully proven (streaming + a real tool round-trip).

## Session-workflow notes (learned the hard way)

- **Screenshots are broken** in the Claude Code browser pane (times out even on plain JSON;
  canvas reports width 0 because the pane is hidden). Verify UI via
  `javascript_tool` + `getComputedStyle`/DOM assertions instead. `mcp__visualize__show_widget`
  works if you need to *show* Idris something.
- **Don't rebuild/restart while a long run is in flight** (rule 11) — it dies with the process.
- Long PowerShell one-liners paste badly over RDP; give Idris 2–3 short lines instead.
- Idris runs 3 machines with **different usernames** — never hand him a path with someone
  else's username in it. The agent page now detects this and says so (v38).
- **Idris runs commands in PowerShell, not cmd.** Repo scripts need `.\` (`.\stop.cmd`,
  `.\server.cmd`) because PowerShell doesn't resolve from the cwd; installed tools (`git`, `npm`,
  `hermes`, `openclaw`) take **no** prefix — he hit `.\npm` after one under-specified answer.
  Also: Windows PowerShell 5.1 has **no `&&`** (split into separate lines), `start "" /min` is
  cmd-only (use `Start-Process … -WindowStyle Hidden`), and `curl` is an alias for
  `Invoke-WebRequest` (use `curl.exe`).
- **Verify restarts properly:** `stop.cmd` → confirm the port is actually free → then launch.
  Sleeping 2s and launching blind is how the silent-start bug got misdiagnosed as "my build
  broke it". `Get-NetTCPConnection -LocalPort 3000 -State Listen` is the check.
- **A comparison between two values that can BOTH fail silently reports "no change", not
  "couldn't measure".** Burned twice in one session: a lease-renewal check where both reads
  returned empty (Node can't resolve Git Bash `/c/...` paths) and a preset check that read a
  hardcoded *placeholder* instead of the field's value. Assert the reads are non-empty and that
  you're reading the thing you think you are, before comparing. Also `%errorlevel%` in a
  one-line cmd `&` chain expands at PARSE time — use `cmd /v:on` + `!errorlevel!`.
- Cluster failover is **eventually consistent via OneDrive** — expect ~90s for a role change or
  reclaim to land, and a brief window where two nodes' heartbeats both say `isMaster: true`.
  The lease file is the arbiter; a `term` bump means a real re-election, an unchanged `term`
  means a clean uncontested handover.

## Suggested first message for the new session

> Read NEXT-SESSION.md in mission-control. Check the fleet is green (`/api/system`,
> `/api/agents`) and the cluster (`/api/cluster` — expect DESKTOP-K82OGAE as master),
> then: [your goal for the session]

Note `/api/agents` caches a successful version probe **forever** (`expires: Infinity`), so a
version string there can be stale after a CLI upgrade until the server restarts — the binary on
disk is the truth (this made OpenClaw look like 2026.6.11 long after it was 2026.7.1).
