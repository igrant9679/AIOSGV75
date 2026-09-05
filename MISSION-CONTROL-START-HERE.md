# Mission Control — Start Here (portable handoff)

**Written 2026-09-04 from the retired GV75 desktop, at commit `55b4e30`.**

> **Give this file to Claude Code on the new machine as the first message:**
> `Read MISSION-CONTROL-START-HERE.md and get Mission Control running on this machine.`

This one file is enough to bootstrap from nothing. Everything deeper lives in the
repo itself — see [§6 Read next](#6-read-next-in-the-repo).

There is also an **offline package** (`Documents\mission-control-portable\` on the
GV75 desktop) holding this doc, a secret-free zip of the tree including `.git`, an
annotated `.env.local.example`, and `data-template/MACHINE-LOCAL-STATE.md`. You do
not need it if you can reach GitHub — everything it carries is either in the repo or
summarised below.

---

## 1. What Mission Control is

A **local-first AI operating system**: a Next.js 16 + Tailwind v4 + Framer Motion
dashboard that orchestrates a fleet of AI agents, with an **Obsidian vault as its
persistent brain**. It runs on `127.0.0.1:3000` **only** — it executes shell
commands, so it must never be exposed to a LAN or the internet, and it has no auth
layer by design.

Chats · missions (MoA/pipeline/debate/arena) · schedules with Telegram delivery ·
watchers · approval gates answerable from Telegram · shared memory + link-aware RAG ·
knowledge graph · smart routing (Auto) · analytics/evals/arena · 18 exportable
reports · Creative Studio · SEO content pipeline → WordPress/Ghost/Webflow ·
imported ChatGPT+Claude history (2,242 conversations → 187 vault notes) · voice
in+out · built-in searchable guide at `/guide`.

**Repo:** <https://github.com/igrant9679/AIOSGV75> — branch `main`, **public**
(no auth needed to clone). Versions v1 → v42.1.

**Why it can't be hosted in the cloud:** the Next.js server *is* the engine room —
it spawns local CLIs (`claude -p`, `openclaw`, `hermes`, `codex exec`), reads the
vault off disk, and talks to `localhost` Ollama. In a container none of that exists.
For phone/laptop access the plan is **Tailscale**, never public hosting.

---

## 2. The fleet

| Agent | Kind | How it runs |
| --- | --- | --- |
| **Claude** | CLI bridge | `app/api/claude/route.ts` spawns `claude -p --output-format stream-json`, relays NDJSON as SSE, prompt via stdin, `--resume` for sessions. **The only required agent.** |
| **Talos** (OpenClaw) | command agent | `openclaw agent --agent main --message {input}` — also the **Telegram gateway**. One machine only. |
| **Hermes** | command agent | Nous Hermes CLI, one-shot `-z {input}`, absolute path from `.env.local` |
| **DeepSeek / GLM / OpenRouter / any API LLM** | OpenAI-compatible | `/api/llm` streaming tool loop (`lib/llmTools.ts`) |
| **Llama** | local LLM | Ollama `http://localhost:11434/v1`, keyless |
| **Codex** | command agent | `codex exec --skip-git-repo-check {input}` (flag required — the app spawns from a non-repo cwd) |
| **Auto** | virtual router | `lib/router.ts` picks by task tier, arena win-rate, cost, health; fails over to Claude |

---

## 3. Get a working copy (pick one)

### A. Fresh machine, online — one-liner (recommended)

In **PowerShell**, as your normal user:

```powershell
irm https://raw.githubusercontent.com/igrant9679/AIOSGV75/main/install.ps1 -OutFile "$env:TEMP\mc-install.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\mc-install.ps1"
```

Installs Git / Node LTS / Ollama via winget, clones + `npm install` + build, pulls
`llama3.2` + `nomic-embed-text`, installs Claude Code (+ optional Codex), writes a
starter `.env.local`, and registers the auto-start VBS. Idempotent; flags `-DryRun`,
`-Yes`, `-SkipModels`, `-InstallCodex`, `-RepoDir`, `-Vault`.

It **cannot** do three things and says so at the end: `claude` → `/login`, pointing
`VAULT_DIR` at the synced vault, and entering Studio/publishing keys in Settings.

### B. Plain clone

```powershell
cd $env:USERPROFILE\Documents
git clone https://github.com/igrant9679/AIOSGV75 mission-control
cd mission-control
npm install
```

### C. From the offline package (no GitHub reachable)

Unzip `mission-control-2026-09-04.zip` into `%USERPROFILE%\Documents\mission-control`.
It includes `.git`, so it is already a repo pointed at `origin` — `git pull` works
the moment you're online. Then run `npm install` (`node_modules` is **not** in the zip).

> `npm` commands must run **inside** the repo folder, or you get
> `ENOENT: could not read package.json`.

**Windows first-run friction, both worth knowing:** a terminal only reads `PATH`
when it opens, so open a **fresh** window after any winget install (or patch the
session: `$env:Path += ";C:\Program Files\nodejs"`). And if `npm` dies with
*"running scripts is disabled"*, either use `npm.cmd` everywhere or fix it once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

---

## 4. What does NOT travel — the per-machine checklist

Git carries **code only**. Neither `.env.local` nor `data/` is in the repo, and
neither is synced. Work this list top to bottom:

- [ ] **`.env.local`** — create it in the repo root. `VAULT_DIR` is the one truly
      required line; the complete reference for every variable the app reads is
      **`SETUP-NEW-MACHINE.md` §4b** (`.env.local.example` in the offline package is
      the same thing as a fill-in-the-blanks file).
      **Every path in it must name THIS machine's profile folder** — a copied
      `.env.local` is the #1 cause of a red agent (v38 detects this and says so on
      the agent page).
- [ ] **The vault** — sign into the same OneDrive (LSI Media LLC) account, sync the
      `AI Mission Control\IdrisGV75` library, right-click → **"Always keep on this
      device"** (placeholder files make vault scans slow and flaky), and let it
      finish **before** first boot. Point `VAULT_DIR` at the folder that *directly
      contains* `Agentic OS`.
      **OneDrive is the one and only sync engine** — leave Obsidian's Sync core
      plugin OFF on every machine. Two engines on one folder fight each other.
- [ ] **`claude` → `/login`** — from a **fresh PowerShell window**, never from a
      terminal inside another Claude Code session (inherited `CLAUDE_*`/`ANTHROPIC_*`
      vars poison the handshake; the app's bridge strips them for the same reason).
      Verify headless: `claude -p "say ok"`.
- [ ] **LLM keys** — re-enter in Settings → LLM Connections; the pool is per-machine,
      so a thin "N models in pool" badge means keys were never entered here, not a
      bug. Which ones, with base URLs and models, in the table below.
- [ ] **`TELEGRAM_BOT_TOKEN`** in `.env.local` — required on any machine that can
      become **master**. Without it every scheduled notification fails *silently*
      (the send returns false, the run still records success). The value lives in
      the gateway machine's `~/.openclaw/openclaw.json` → `channels.telegram.botToken`.
- [ ] **Cluster role** — Settings → Machine Group & Roles (per-machine, stored in
      `data/cluster.json`; a role can only be changed *on that machine*).
- [ ] **Schedules** — only on a machine that can become master; a workstation stays
      empty. The four live ones: 📚 Vault Librarian (Sun 18:00 → vault) · 🛠 Ops
      Tuner (Sun 19:00 → Telegram) · 🗞 Chief of Staff (weekdays 08:00 → Telegram) ·
      📊 CommunityForce Monday Status (Mon 08:30 → Telegram).
- [ ] **Optional CLIs** — Ollama (free local Llama + the embeddings behind semantic
      RAG), Codex (`npm i -g @openai/codex` → `codex login`), Hermes, OpenClaw.
      **Do not install the OpenClaw gateway** unless you are deliberately moving it
      (see §5).

**The registry to rebuild** (`data/registry.json` is per-machine and git-ignored, so
none of this arrives with a clone):

| Agent id | Provider | Base URL | Model | Key |
| --- | --- | --- | --- | --- |
| `deepseek` | `deepseek` | `https://api.deepseek.com/v1` | `deepseek-chat` | real, prepaid, unused → $0 |
| `openrouter` | `openrouter` | `https://openrouter.ai/api/v1` | `nvidia/nemotron-3-super-120b-a12b:free` | free tier, rate-limited |
| `glm` | `glm-coding` | `https://api.z.ai/api/coding/paas/v4` | `glm-5.2` | GLM Coding Pro, flat-rate |
| `llama` | `ollama` | `http://localhost:11434/v1` | `llama3.2` | **none** — keyless, tick REMOVE KEY |

> ⚠ **The GLM base URL must be `/api/coding/paas/v4`.** The metered `/api/paas/v4`
> returns `429 code 1113 "Insufficient balance"` with the *same valid key* — a
> 429/1113 on z.ai means wrong endpoint, not a bad key.

Also per-machine and worth knowing: `services.json` holds a Brave Search key,
`publish.json` is empty (no WordPress/Ghost/Webflow creds ever entered), `mcp.json`
points the filesystem MCP server at that machine's own Documents folder, and no
Studio keys (OpenAI / Gemini / ElevenLabs / Replicate) exist anywhere yet.
`embeddings-cache.json` rebuilds itself from vault content — never copy or sync it.

**No key values appear in this document.** Where each one actually lives:

| Secret | Where to read it |
| --- | --- |
| DeepSeek / OpenRouter / GLM keys | GV75 desktop `…\mission-control\data\registry.json` |
| Brave Search key | GV75 desktop `…\mission-control\data\services.json` |
| Telegram bot token | Legion7 (gateway) `~/.openclaw/openclaw.json` → `channels.telegram.botToken` |
| Claude / Codex / Hermes | interactive login only — no file to copy |

---

## 5. Where the new machine fits in the fleet

Shared across machines: the **vault** (memory, RAG, goals, journal, task board,
approvals, chats, missions, profile). Per-machine: `data/*.json`, `.env.local`,
CLI logins, schedules, arena standings, the usage ledger.

Fleet as of 2026-08-27:

| Host | Role | State |
| --- | --- | --- |
| `IdrisLegion7` | **primary → MASTER** | all 4 schedules · **Telegram gateway (Talos)** · bot token set |
| `WIN-C2ANEVBHN6Q` (Raider18) | **backup** | armed (schedules + token); takes over if the primary's lease lapses. **The gateway does NOT fail over.** Its uptime is the fleet's weak point. |
| `DESKTOP-K82OGAE` (GV75 desktop) | **RETIRED 2026-08-27** | server stopped, autostart + gateway disabled, forgotten from the cluster. Repo and `data\*.json` left intact on disk — that is where the keys still are. **Do not restart its server or re-enable its "OpenClaw Gateway" task.** |

**Choose a role for the new machine:**

- **workstation** (safe default) — same brain, every agent chattable, no scheduled
  jobs, no gateway. Nothing can double-fire.
- **backup** — arm it with schedules + `TELEGRAM_BOT_TOKEN` so it can take over.
- **primary** — only if you are deliberately moving the master.

Failover is **eventually consistent via OneDrive**: expect ~90s for a role change to
land, and a brief window where two nodes both claim `isMaster`. `Cluster/lease.json`
is the arbiter — a bumped `term` means a real re-election, an unchanged one means a
clean handover.

Two rules that produce real bugs when broken:

1. **Only ONE machine may poll the Telegram bot.** Two gateways on one bot steal
   each other's updates and approvals land on the wrong machine. That machine is
   **Legion7**. The gateway does *not* have to be the master — approvals are
   vault-backed (`Agentic OS/Approvals.json`), so any machine can raise or answer
   one and the master launches the mission.
2. **Every machine that can become master must be up to date.** A stale master is
   the whole fleet's behaviour. Run `.\update.cmd` after anything lands.

⚠ **Account names lie on the laptops.** Legion7's Windows account is *named* `idris`
but its profile folder is `C:\Users\sabin` (renamed account — there is no `sabin`
login); Raider18's is `msi\idris`. `whoami` cannot tell them apart — use `hostname`,
and key every script off `$env:USERPROFILE`, never `$env:USERNAME`. When Idris says
"sabine's machine" he means **IdrisLegion7**.

**A healthy workstation looks "broken" in three ways — don't chase them:**
Talos/OpenClaw red forever (the gateway lives elsewhere), agents missing from the
sidebar until you add their keys, and empty Schedules/Watchers pages.

---

## 6. Read next, in the repo

| File | What it's for |
| --- | --- |
| **`AGENTS.md`** | The agent context brief — fleet table, map of the code, and the 13 hard-won rules. `CLAUDE.md` is just `@AGENTS.md`, so Claude Code loads it automatically. **Read this before writing code.** |
| **`SETUP-NEW-MACHINE.md`** | The full human setup guide — machine prep, Obsidian/vault sync options, every CLI, the complete `.env.local` reference, auto-start, verification, troubleshooting table, FAQ. |
| **`NEXT-SESSION.md`** | The living session log — dated fleet/config state, every open item, what was tried and failed, and the workflow lessons. Long, but it is where "why is it like this?" gets answered. |
| **`README.md`** | Feature overview. |
| `/guide` in the app | The in-app manual (source `lib/guideContent.ts`), also exported to the vault daily so agents can answer questions about the OS via RAG. |

⚠ **`AGENTS.md` opens with a warning worth heeding: this is Next.js 16, not the
Next.js in your training data.** Read `node_modules/next/dist/docs/` before writing
framework code.

---

## 7. The rules that bite

1. **`data/*.json` is the source of truth — never module-cache it.**
   `instrumentation.ts` (the scheduler) and route handlers are *separate module
   instances*; an in-memory cache in one is invisible to the other. Missions use
   per-mission read-modify-write.
2. **Never cache a failed agent probe permanently.** Cold-booting CLIs time out;
   cache successes, give failures a 60s TTL.
3. **`ACCENTS.base` is a CSS var** (`var(--ac-*)`) — never string-concat alpha onto
   it (use `.border` / `.soft` / `.glow`). SVG colors from ACCENTS go via `style={}`,
   not presentation attributes.
4. **Theme** = `data-theme` on `<html>`, applied by a pre-paint boot script in
   `layout.tsx` (the `suppressHydrationWarning` there is intentional).
5. **Add or change a feature → update `lib/guideContent.ts`.** It is the in-app
   manual *and* the daily vault export that agents read.
6. **OS verbs** (`<remember>`, `<goal>`, `<journal>`, `<mission>`) are harvested from
   chat replies only — never from mission outputs (anti-recursion). `<mission>` goes
   through the approval gate.
7. **Adding an LLM provider preset = 3 files:** `lib/providers.ts`, `lib/router.ts`
   (a `COST_RANK` entry — the `?? 6` default mis-prices anything genuinely cheap or
   dear), and `lib/guideContent.ts`. The router entry is the easy one to miss.
8. **In-flight runs die with the server process.** Never rebuild-and-restart while a
   schedule/mission/orchestration is running — check the mission log and the Ops
   Pulse queue first.
9. **Don't run concurrent arena battles with local/CLI fighters** (Ollama, Hermes) —
   simultaneous runs per agent make them error. Sequential only; cloud APIs tolerate it.
10. `ChatThread.tsx` has contained a literal NBSP (U+00A0) — if exact-match editing
    fails there, that is why.
11. Canvas/React traps from `/graph`: a conditional *sibling* remounts a non-keyed
    canvas and orphans its animation loop (mount canvases unconditionally, overlay
    empty states), and rAF is fully suspended in hidden tabs — pair every frame with
    a timer fallback if work must settle off-screen.
12. **`vaultInfo().base` already includes `Agentic OS`** — don't join it again.
13. **Verify an agent can QUOTE an instruction before believing it landed.**
    `~/.openclaw/workspace/TOOLS.md` is *not* injected into Talos's context; a whole
    fix was once built on editing it and reported as working.

**The silent-failure pattern that has bitten this project four separate times:**
something that fails while reporting success. A `findstr` guard that stopped the
server with no output at all; Telegram sends returning false while the run recorded
success; a comparison where *both* reads failed and so reported "no change"; a
PowerShell `Where-Object` that matched nothing, so `$null.apiKey` sent `Bearer ` and
every endpoint 401'd (read as "the key is dead" when the key was never sent).
**Assert your reads are non-empty, and that you are reading the thing you think you
are, before trusting any comparison.** And check *which tool actually ran* before
diagnosing the tool — a wrong answer is not proof of a failed tool.

---

## 8. Dev cycle on the new machine

```powershell
.\stop.cmd
```

```powershell
npm run dev
```

`stop.cmd` **always** comes first — the boot server owns port 3000. (It ends with a
`pause`, so don't chain it in a script without piping input.)

After code changes:

```powershell
npm run build
```

```powershell
Start-Process .\server.cmd -WindowStyle Hidden
```

- The **prod** server auto-starts at Windows login via `Mission Control Server.vbs`
  (Startup folder) → `server.cmd` → `npm start -- -H 127.0.0.1`. Install it with
  `install-service.cmd` (optionally `install-service.cmd "D:\path\to\repo"`). This is
  the fix when the server "doesn't auto-start" or "dies when I close the window".
- The running server serves **old bundles** until it is restarted. A `git pull` alone
  changes nothing.
- `update.cmd` = pull → install → build → restart in one shot. **But don't run it
  when the pull rewrites `update.cmd` itself** — `cmd.exe` reads a batch file by byte
  offset and re-reads after each command, so replacing it mid-run resumes at a
  meaningless position. Do those steps by hand instead.
- Dev serving stale CSS/JS after big edits → `rm -rf .next/dev`, restart dev.
- **Verify restarts properly:** stop → confirm the port is actually free
  (`Get-NetTCPConnection -LocalPort 3000 -State Listen`) → then launch. Sleeping 2s
  and launching blind is how a silent-start bug once got misdiagnosed as "my build
  broke it".
- `server.cmd` prepends `.local\bin` / npm-global / Ollama to `PATH`. If an agent
  shows red but its CLI works fine in a terminal, suspect the **server process's**
  PATH.

**PowerShell notes** (Idris runs PowerShell, not cmd): repo scripts need `.\`
(`.\stop.cmd`), installed tools do **not** (`git`, `npm`, `hermes`, `openclaw`).
Windows PowerShell 5.1 has **no `&&`** — split into separate lines. `start "" /min`
is cmd-only; use `Start-Process … -WindowStyle Hidden`. `curl` is an alias for
`Invoke-WebRequest` — use `curl.exe`. Long one-liners paste badly over RDP; prefer
2–3 short lines.

---

## 9. Verify, in this order

```powershell
curl.exe http://127.0.0.1:3000/api/vault/status
curl.exe http://127.0.0.1:3000/api/system
curl.exe http://127.0.0.1:3000/api/agents
curl.exe http://127.0.0.1:3000/api/registry
curl.exe "http://127.0.0.1:3000/api/vault/search?q=test"
curl.exe http://127.0.0.1:3000/api/cluster
```

1. `vault/status` — **the definitive check**: `ok:true` plus your vault path.
2. `system` — server up.
3. `agents` — CLI agents green (cold-boot probes can take ~45s).
4. `registry` — your LLMs show `hasKey:true`.
5. `vault/search` — RAG answering.
6. `cluster` — role and master are what you intended.
7. `dir data\embeddings-cache.json` — exists after step 5 = semantic RAG active.
8. **Task-board test (fastest brain proof)** — open `/tasks`; the shared board from
   the other machines should already be sitting there.
9. **Memory round trip** — on the new machine tell Claude *"Save to shared memory:
   setup test from \<hostname\>"*; let the vault sync; on another machine ask any
   agent what was recently saved. That proves sync + shared memory + RAG end to end.

> `/api/agents` caches a **successful** version probe forever (`expires: Infinity`),
> so a version string there can be stale after a CLI upgrade until the server
> restarts. The binary on disk is the truth.

**If the brain looks dead** — "Vault offline" on Memory, empty task board, red
Goals/Journal/Library — it is almost always `.env.local`: missing, wrong
`VAULT_DIR`, saved as `.env.local.txt` by Notepad, or OneDrive hasn't finished
syncing. Fix it, then **restart the server**; env is read only at boot.

---

## 10. State as of 2026-09-04

**Code:** `main` @ `55b4e30`, local == `origin/main`, working tree clean. The only
untracked file is `Mission Control Server.vbs.disabled` — the GV75 desktop's Startup
launcher, parked in the repo folder when the machine was retired (restore by moving
it back to `shell:startup` and dropping `.disabled`).

**Billing:** real API spend ≈ **$0**. Claude, Codex, Hermes and Talos are all
subscriptions; Llama is local; OpenRouter is on a `:free` model; DeepSeek's key is
real but unused. Two caveats: **Nous inference is metered prepaid credits** — Hermes
only costs $0 while it stays on a `:free` model — and the Claude CLI reports
`total_cost_usd` even on a subscription, which is an estimate at list prices, **not a
bill** (`lib/billing.ts` exists to keep that split honest in Analytics and Reports).

**Open items carried forward** (full detail in `NEXT-SESSION.md` § "⚠ OPEN"):

1. **Nothing restarts a dead prod server mid-session.** The Startup VBS only fires
   at Windows *login*. On 2026-08-08 the desktop's server stopped silently mid-run
   while the designated master was also offline — the fleet had **no master at all**
   for two days, and only a quiet weekend hid it. A ~5-minute Scheduled Task that
   checks `Get-NetTCPConnection -LocalPort 3000 -State Listen` and relaunches
   `server.cmd` would close this. **Still open, and the best first contribution a new
   machine could make.**
2. **Raider18's uptime is the fleet's weak point** — it was down ~4 weeks in August
   before being promoted to backup. Watch its online badge.
3. **`kimi-2` on Raider18 holds the wrong vendor's key** (the z.ai GLM key pointed at
   `api.moonshot.ai` → 401). Needs a real Moonshot `sk-…` or deletion — and that
   machine could gain a proper GLM agent from the key already sitting there. Must be
   done **on that machine**; `registry.json` is per-machine and invisible from elsewhere.
4. **Studio + Content are still un-activated** — no real image/voice/video or
   publishing keys anywhere. Only the no-key and bad-key paths are proven. Ghost and
   Webflow have never been pushed to a real site.
5. **Legion7's Hermes may still be on metered GLM 5.2** rather than free
   `tencent/hy3:free` — unverified, and if so it spends prepaid Nous credits on every
   call. Check on that machine via `/hermes-lab` → Model & Fallback.
6. **The ChatGPT half of the history was never imported** (the 2026-07-16 run was
   Claude-only, 2,242 conversations). Safe to run anywhere — but a *fresh Claude
   export* requires copying `data/llm-import.json` first, or a distill regenerates all
   187 History notes into the shared vault and duplicates them fleet-wide.
7. **Do not disturb the GV75 desktop's Gemini OAuth grant** — it may be
   unreproducible (new grants on other machines fail with
   `requires GOOGLE_CLOUD_PROJECT`). Never "fix" that by setting
   `GOOGLE_CLOUD_PROJECT`; it routes inference through a billed GCP project. Moot
   while Talos runs `zai/glm-5.2`, but worth not breaking.
8. **The Telegram bot token was exposed on 2026-07-16 and has never been rotated.**
   Idris explicitly deprioritised this — **don't re-raise it unsolicited**, just don't
   assume it's fixed. Rotating means updating both `openclaw.json` and every
   `TELEGRAM_BOT_TOKEN` in `.env.local`.
9. **Verify the GLM Coding Pro plan renewed** — it was set to auto-renew 2026-09-03,
   the day before this doc was written.

---

## 11. Suggested first message once it's running

> Read `NEXT-SESSION.md` in mission-control. Confirm the fleet is green
> (`/api/system`, `/api/agents`) and check the cluster (`/api/cluster` — expect
> `IdrisLegion7` as master), then: **[your goal for the session]**

And the habit that makes continuity actually work — end a session with
*"Remember: … Add a goal: … Journal: …"*. Those land in the shared vault, and every
agent on every machine picks them up.
