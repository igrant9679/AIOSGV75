# Mission Control — Complete Setup Guide

From bare Windows machine to a running Mission Control instance: machine prep,
every tool the OS uses, Obsidian/vault configuration (including multi-machine
sync), the app itself, and verification.

---

## 0. Understand the topology first

Mission Control is **local-first**: the web app, the agent CLIs, and the vault
all live on the same machine. Multi-machine = multiple full installs sharing
one brain (the synced Obsidian vault).

| | Shared across machines | Per-machine |
| --- | --- | --- |
| **Mechanism** | The synced Obsidian vault | `data/*.json` + `.env.local` (both git-ignored) |
| **What** | Shared memory, RAG (BM25 + semantic), goals, journal, chat logs, mission archives, knowledge graph, Guide | API keys, command agents, workspaces list, schedules, watchers, arena standings, usage ledger, CLI logins |

Pick roles before you start:

- **PRIMARY** (exactly one machine): runs schedules, watchers, and the
  Telegram/approvals gateway (OpenClaw/Talos).
- **WORKSTATION** (everything else): same brain, all agents chattable, no
  scheduled jobs, no Telegram gateway.

> **Why one gateway:** the OpenClaw gateway long-polls the Telegram bot; two
> gateways on one bot steal each other's updates and approvals land on the
> wrong machine.
> **Why no schedules on workstations:** a schedule that exists on two machines
> fires twice.

---

## 1. Machine prep

**Hardware guidance**

- Any modern x64 machine runs the app itself (it's a Node server).
- Local Llama via Ollama: `llama3.2` (3B) is comfortable on 8–16 GB RAM,
  CPU-only. 7–8B models want ~24 GB. Models cost 2–5 GB disk each.
- ~10 GB free disk covers Node, the app, and the two default Ollama models.

**Base tools** (PowerShell, run as your normal user):

```powershell
winget install OpenJS.NodeJS.LTS       # Node 20+ and npm
winget install Git.Git
winget install Obsidian.Obsidian
winget install GitHub.cli              # optional — only for gh/PR workflows
```

Close and reopen the terminal afterwards so PATH updates take effect.
Verify: `node --version`, `git --version`.

**Optional but recommended: Tailscale** — lets your phone/laptop open this
machine's dashboard over a private network without exposing anything to the
internet (`winget install Tailscale.Tailscale`, sign in with the same account
on every device). The server binds 127.0.0.1 by design; if you later want
Tailscale access, that's a deliberate follow-up change — ask before widening
the bind address.

**Git identity** (first time on the machine):

```powershell
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

---

## 2. Obsidian & the vault (the brain)

The app reads/writes markdown under `<vault>/Agentic OS/` — shared memory,
goals, journal, chat logs, mission archives, the knowledge graph, and the
exported Guide. Sync the vault and every machine shares one mind.

### 2a. First machine (no vault yet)

1. Open Obsidian → **Create new vault**. Name it, put it somewhere stable
   (e.g. `C:\Users\<you>\Documents\<VaultName>`). Avoid deeply nested or
   OneDrive-managed paths unless that IS your sync method (see below).
2. The app scaffolds `Agentic OS/` (Home.md, Memory.md, Goals.md, folders) on
   first boot — you don't create it by hand.

### 2b. Additional machines (vault exists)

Sync the existing vault down first, then install the app. Confirm
`Agentic OS/` arrived before first boot.

### 2c. Sync options, in order of preference

**Obsidian Sync (paid — easiest, end-to-end encrypted, per-file merge)**
1. On the existing machine: Settings → Sync → set up remote vault, choose
   what to sync (turn **everything on** for content; see 2d for `.obsidian`).
2. On the new machine: create an empty vault → Settings → Sync → connect to
   the same remote vault → let it fully download before first app boot.

**Syncthing (free, peer-to-peer, no cloud)**
1. Install on both machines (`winget install Syncthing.Syncthing`), share the
   vault folder.
2. Add ignore patterns (Folder → Ignore Patterns) so machine-local UI state
   doesn't ping-pong:
   ```
   .obsidian/workspace.json
   .obsidian/workspace-mobile.json
   .trash
   ```

**OneDrive / Dropbox (works, with caveats)**
- Put the vault inside the synced folder — BUT right-click the vault folder →
  **"Always keep on this device."** Files-on-demand placeholders make the
  app's vault scans slow and flaky.
- Cloud-drive sync is file-level: if two machines write the *same* file in the
  same window you get `...-conflict` copies. In practice the app mostly
  appends to date-stamped files (Chats/2026-07-11.md, Journal/...), so
  conflicts are rare unless you actively use two machines simultaneously.
  If you will routinely run both at once, prefer Obsidian Sync or Syncthing.

**Git (obsidian-git plugin)** — fine for a solo, mostly-one-machine-at-a-time
workflow; commit/pull cadence is yours to manage. Not recommended as the
primary mechanism here because the app writes constantly.

### 2d. What to do about `.obsidian/` (Obsidian's own config)

- **Sync**: themes, snippets, community plugins, settings — nice to have
  identical everywhere (Obsidian Sync has toggles for each; Syncthing syncs
  them by default).
- **Never sync**: `workspace.json` (open-tabs layout — machine-local; the
  Syncthing ignore above handles it, Obsidian Sync excludes it automatically).
- The app itself needs **none** of `.obsidian/` — it reads plain markdown.
  Obsidian doesn't even need to be running for Mission Control to work; it's
  your window into the brain, not a dependency.

### 2e. Multi-machine vault rules

- Every machine points `VAULT_DIR` (step 4b) at its **local** copy — the path
  can differ per machine; the *contents* are what sync.
- Let sync finish before booting the app on a new machine (a half-synced
  vault means a half-indexed RAG for a couple of minutes; harmless but
  confusing).
- The semantic-embeddings cache (`data/embeddings-cache.json`) is per-machine
  and rebuilds automatically from vault content — never sync it.

---

## 3. Agent CLIs — the tools the OS drives

Install per machine, only what that machine should have. **Only Claude Code is
required.**

### 3a. Claude Code (required)

Powers the Claude agent, missions, schedules, the evals judge, and Auto's
failover.

```powershell
winget install Anthropic.ClaudeCode    # or: npm install -g @anthropic-ai/claude-code
claude                                  # starts interactive session
# inside it: /login  → browser sign-in → close the session
claude -p "say ok"                      # MUST answer headlessly with no prompt
```

Gotcha: do the `/login` from a **fresh PowerShell window**, never from a
terminal inside another Claude Code session — inherited `CLAUDE_*`/
`ANTHROPIC_*` env vars poison the handshake. (The app's bridge strips these
for the same reason.)

### 3b. Ollama (recommended — free local Llama + the embeddings behind semantic RAG)

```powershell
winget install Ollama.Ollama
# reopen terminal, then:
ollama pull llama3.2           # ~2 GB — tool-capable chat model
ollama pull nomic-embed-text   # ~274 MB — embeddings for semantic RAG
curl http://localhost:11434/api/tags   # both models listed = ready
```

The installer adds Ollama to Startup, so the endpoint is always available.
Alternative models: `qwen2.5`, `mistral`, `deepseek-r1` (chat);
LM Studio works too (Custom LLM at `http://localhost:1234/v1`).

### 3c. Codex CLI (optional — OpenAI's coding agent)

```powershell
npm install -g @openai/codex
codex login        # one-time browser sign-in (ChatGPT/OpenAI account)
codex exec --skip-git-repo-check "say ok"   # verify headless
```

### 3d. Hermes (optional — Nous Research agent)

Install per Nous Research's instructions. What Mission Control needs at the
end: a working `hermes.exe` invocable as `hermes -z "<message>"`. Note the
absolute path (typically
`%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\hermes.exe`) for `.env.local`
— the venv's Scripts dir isn't reliably on PATH in non-interactive shells.

### 3e. OpenClaw / Talos + Telegram (PRIMARY machine only)

The Telegram gateway, approval protocol, and the Talos persona live in
`~/.openclaw/`. **Do not set this up on workstations** (see §0).

If you're building a *new* primary (or moving the role):

1. Install OpenClaw per its docs; make sure `openclaw` is on PATH.
2. Copy the old primary's `~/.openclaw/workspace/` — it contains:
   - `TOOLS.md` — the Mission Control approval protocol (the curl commands
     Talos uses to answer approvals from Telegram). **If the dashboard's
     port/paths ever change, update this file.**
   - `IDENTITY.md` — Talos's name/persona. `SOUL.md`, `USER.md` — personality
     and owner context.
3. Re-register the gateway to run at login (on the old primary it's a Windows
   Scheduled Task) and disable it on the old machine — one gateway, ever.
4. Telegram pairing (bot + owner id) rides along in OpenClaw's config;
   verify with a test message before trusting approvals to it.

---

## 4. The Mission Control app

### 4a. Install

```powershell
cd $env:USERPROFILE\Documents
git clone https://github.com/igrant9679/AIOSGV75 mission-control
cd mission-control
npm install
```

### 4b. Configure `.env.local` (git-ignored — create on every machine)

Full reference (every variable the app reads):

```ini
# ── Vault ────────────────────────────────────────────────────────────
# REQUIRED unless your vault happens to be at the default path in lib/vault.ts.
# Point at the folder that CONTAINS "Agentic OS" (or will, on first boot).
VAULT_DIR=C:\Users\<you>\Documents\<VaultName>

# ── Semantic RAG (recommended; keyless via local Ollama) ─────────────
EMBED_BASE_URL=http://localhost:11434/v1
EMBED_MODEL=nomic-embed-text
# Cloud alternative (then EMBED_API_KEY is required):
#   EMBED_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
#   EMBED_API_KEY=<free key from aistudio.google.com>
#   EMBED_MODEL=text-embedding-004

# ── Command-agent bridges (only where installed) ─────────────────────
# OPENCLAW_CMD=openclaw agent --agent main --message {input}    # PRIMARY only
# OPENCLAW_BIN=openclaw                                          # probe binary override
# HERMES_BIN=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe
# HERMES_CMD=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe -z {input}

# ── Telegram delivery (PRIMARY only; defaults to the owner id baked
#    into lib/telegram.ts if unset) ──────────────────────────────────
# TELEGRAM_TARGET=<your telegram user id>

# ── Claude auth override (rarely needed — CLI login is the norm) ─────
# ANTHROPIC_API_KEY=sk-ant-...   # the bridge whitelists this env var
```

### 4c. Build and first boot

```powershell
npm run build
npm start -- -H 127.0.0.1
```

Open http://127.0.0.1:3000. On first boot the app scaffolds
`Agentic OS/` in the vault (or adopts the synced one).

### 4d. In-app configuration (Settings)

1. **LLM Connections** — add per machine (keys live only in this machine's
   `data/registry.json`):
   - DeepSeek / OpenRouter / Kimi / GLM / Grok / Gemini presets: pick, paste
     key. Rotate later with the pencil icon on the row.
   - Local Llama: provider **Custom**, name `Llama`, Base URL
     `http://localhost:11434/v1`, model `llama3.2`, **API key blank**.
2. **Command Agents** — `Codex` with template `codex exec --skip-git-repo-check {input}` (if
   installed + logged in). OpenClaw and Hermes are built-ins driven by
   `.env.local`, not added here.
3. **Workspaces** — recreate the names you use (e.g. `Work`,
   `CommunityForce`). Vault folders already exist via sync; this just
   registers them locally.
4. **MCP Servers** — optional extra tools for the Claude bridge (filesystem,
   browsers…); they ride along on every Claude run.
5. **Schedules & Watchers — PRIMARY only.** Leave empty on workstations.

### 4e. Auto-start at login

`server.cmd` starts the prod server safely (skips if port 3000 is taken,
binds 127.0.0.1). Run it hidden at login: `Win+R` → `shell:startup` → create
`Mission Control Server.vbs`:

```vb
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Users\<you>\Documents\mission-control\server.cmd""", 0, False
```

Optional desktop shortcut → `launch.cmd` (opens browser; starts a dev server
only if the port is free). `stop.cmd` kills the server (it ends with a
`pause` — expects a keypress when run by hand).

---

## 5. Verify (in order)

```powershell
curl http://127.0.0.1:3000/api/system     # 1. server up
curl http://127.0.0.1:3000/api/agents     # 2. CLI agents green (cold-boot probe can take ~45s)
curl http://127.0.0.1:3000/api/registry   # 3. LLMs show hasKey:true
curl "http://127.0.0.1:3000/api/vault/search?q=test"   # 4. vault reachable
dir data\embeddings-cache.json            # 5. exists after step 4 = semantic RAG active
```

6. **Chat test**: ask Claude something; confirm a streamed reply.
7. **Brain test (multi-machine)**: on this machine tell Claude
   *"Save to shared memory: setup test from \<machine-name\>"*; wait for the
   vault to sync; on another machine ask any agent *"what was recently saved
   to shared memory?"* If it answers with your phrase, sync + shared memory +
   RAG are all working end-to-end.
8. **PRIMARY only**: toggle a schedule to run-now and confirm the Telegram
   message arrives.

---

## 6. Day-to-day operations

- **Code updates**: `git pull && npm run build`, then restart (`stop.cmd`,
  then the VBS or reboot). The running server serves old code until restarted.
- **Dev work**: `stop.cmd` **before** `npm run dev` (port conflict). Stale
  CSS/JS after big edits → `rm -rf .next/dev`, restart dev.
- **Don't sync `data/`** — it holds plaintext keys and per-machine state, and
  concurrent writes would conflict-storm. Arena standings and the usage
  ledger feeding Auto's routing are deliberately per-machine.
- **Adding a feature?** Update `lib/guideContent.ts` (in-app manual + daily
  vault export that agents use to answer questions about the OS).

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Claude/Hermes offline right after boot | Cold-boot probes are slow; failures cached only 60s. Wait ~1 min. |
| Claude bridge errors about auth | Redo `/login` from a clean PowerShell (not inside a Claude Code session). |
| LLM answers 401 / 402 / 429 | Bad key / no credit (DeepSeek is prepaid) / rate limit. Pencil icon to fix the key. |
| Semantic search not improving results | `ollama ps` — is it running? `nomic-embed-text` pulled? Any embed failure disables the layer for 10 min, then it retries. |
| "vault not found" / empty RAG | `VAULT_DIR` must point at the folder **containing** `Agentic OS/`. Check for OneDrive placeholder files ("Always keep on this device"). |
| `...-conflict` files appearing in vault | Two machines wrote the same file simultaneously via cloud-drive sync. Merge by hand; consider Obsidian Sync/Syncthing. |
| Two Telegram replies per approval/schedule | PRIMARY rule broken — disable the gateway/schedules on one machine. |
| Port 3000 already in use when starting dev | The boot server is running — `stop.cmd` first. |
