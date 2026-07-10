# Mission Control — New Machine Setup

How to run a **full Mission Control instance** on another machine, sharing one
brain (the Obsidian vault) with your existing install.

## How multi-machine works

| | Shared across machines | Per-machine |
| --- | --- | --- |
| **Mechanism** | The synced Obsidian vault | `data/*.json` + `.env.local` (both git-ignored) |
| **What** | Shared memory, RAG (BM25 + semantic), goals, journal, chat logs, mission archives, knowledge graph, Guide | API keys, command agents, workspaces list, schedules, watchers, arena standings, usage ledger, CLI logins |

Pick one machine as the **PRIMARY** — it runs schedules, watchers, and the
Telegram/approvals gateway (OpenClaw). Every other machine is a
**WORKSTATION**: same brain, all agents chattable, but no scheduled jobs and
no Telegram gateway.

> **Why only one gateway:** the OpenClaw gateway long-polls the Telegram bot.
> Two gateways on the same bot steal each other's updates — approvals would
> randomly land on the wrong machine. One PRIMARY, ever.
>
> **Why no schedules on workstations:** a schedule copied to two machines
> fires twice — two Ops Tuner reports, two Monday statuses.

---

## Prerequisites

- Windows 10/11 (paths below assume Windows; the app itself is portable Node)
- **Node.js 20+** and npm — `winget install OpenJS.NodeJS.LTS`
- **Git** — `winget install Git.Git`
- **Obsidian** — `winget install Obsidian.Obsidian`
- A GitHub account with access to `igrant9679/AIOSGV75`

## Step 1 — Sync the vault (the shared brain)

1. Choose a sync method:
   - **Obsidian Sync** (easiest, end-to-end encrypted, paid) — enable in
     Obsidian on both machines, same remote vault.
   - **Syncthing** (free, peer-to-peer) — share the vault folder between machines.
   - **OneDrive/Dropbox** — put the vault folder inside the synced directory.
     (Watch for sync-conflict files; pause sync during heavy writing sessions.)
2. On the new machine, note the **local path** where the vault lands, e.g.
   `C:\Users\<you>\Documents\IdrisGV75\IdrisGV75`.
3. Open it in Obsidian once so it exists and indexes.
4. Confirm `Agentic OS/` exists inside it (Memory.md, Goals.md, Chats/…).

## Step 2 — Install the app

```powershell
cd $env:USERPROFILE\Documents
git clone https://github.com/igrant9679/AIOSGV75 mission-control
cd mission-control
npm install
```

## Step 3 — Configure `.env.local`

Create `mission-control\.env.local` (this file is git-ignored — it never
syncs; create it on every machine):

```ini
# REQUIRED if your vault is not at the default path hard-coded in lib/vault.ts
VAULT_DIR=C:\Users\<you>\Documents\IdrisGV75\IdrisGV75

# Semantic RAG via local Ollama embeddings (keyless) — see Step 4
EMBED_BASE_URL=http://localhost:11434/v1
EMBED_MODEL=nomic-embed-text

# ONLY on machines where these CLIs are installed (see Step 4):
# OPENCLAW_CMD=openclaw agent --agent main --message {input}     <- PRIMARY only
# HERMES_BIN=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe
# HERMES_CMD=C:\Users\<you>\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe -z {input}
```

The full variable reference lives in the app: **/guide → "Settings &
Environment Reference"**.

## Step 4 — Install the agent CLIs

Per machine, install what you want that machine to have. Only Claude is
required.

**Claude Code (required — powers the Claude agent, missions, schedules, evals judge)**
```powershell
winget install Anthropic.ClaudeCode   # or: npm install -g @anthropic-ai/claude-code
claude          # then run /login in the interactive session — browser sign-in
```
Verify headless mode afterwards: `claude -p "say ok"` must answer without
prompting. If auth fails, do the `/login` from a **fresh PowerShell window**
(not from inside another Claude Code session — inherited `CLAUDE_*`/`ANTHROPIC_*`
env vars poison the handshake).

**Ollama (recommended — free local Llama agent + the embeddings that power semantic RAG)**
```powershell
winget install Ollama.Ollama
ollama pull llama3.2          # ~2 GB, tool-capable chat model
ollama pull nomic-embed-text  # ~274 MB, embeddings for semantic RAG
```
Ollama auto-starts at login (installer adds it to Startup). 7–8B models need
~24 GB RAM; `llama3.2` (3.2B) runs on most machines, CPU-only is fine.

**Codex CLI (optional)**
```powershell
npm install -g @openai/codex
codex login    # one-time browser sign-in to your OpenAI/ChatGPT account
```

**Hermes (optional)** — install per Nous docs, then set `HERMES_BIN`/`HERMES_CMD`
in `.env.local` (absolute paths; the venv Scripts dir is not on PATH in all shells).

**OpenClaw / Telegram gateway — PRIMARY MACHINE ONLY.** Do not install the
gateway on workstations (see "Why only one gateway" above). If you ever move
the PRIMARY role, also move `~/.openclaw/workspace/` (TOOLS.md contains the
Mission Control approval protocol; IDENTITY.md is Talos's name).

## Step 5 — First boot & registry

```powershell
npm run build
npm start -- -H 127.0.0.1
```

Open http://127.0.0.1:3000 and go to **Settings**:

1. **Add LLM → DeepSeek** (or any API model you use) — paste the API key.
   Keys live only in this machine's `data/registry.json`; re-enter them on
   each machine. To rotate later, use the pencil icon on the agent's row.
2. **Add LLM → Custom** for local Llama: name `Llama`, Base URL
   `http://localhost:11434/v1`, model `llama3.2`, **no key**.
3. **Command Agents → Add**: name `Codex`, template `codex exec {input}`
   (only if Codex is installed and logged in).
4. **Workspaces**: recreate the ones you use (e.g. `Work`, `CommunityForce`).
   Their vault folders already exist via sync; adding the name here just
   registers them on this machine.
5. **Schedules & watchers: PRIMARY only.** Leave them empty on workstations.

## Step 6 — Auto-start at login

`server.cmd` (in the repo) starts the prod server safely (skips if port 3000
is taken, binds 127.0.0.1 only). To run it hidden at login, create
`Mission Control Server.vbs` in your Startup folder
(`Win+R` → `shell:startup`):

```vb
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Users\<you>\Documents\mission-control\server.cmd""", 0, False
```

Optional desktop shortcut: point it at `launch.cmd` (opens the browser; starts
a dev server only if nothing owns port 3000). `stop.cmd` kills the server —
note it ends with a `pause`, so it wants a keypress when run by hand.

## Step 7 — Verify

```powershell
curl http://127.0.0.1:3000/api/system    # server up
curl http://127.0.0.1:3000/api/agents    # CLI agents probe green (first probe after cold boot can take ~45s)
curl http://127.0.0.1:3000/api/registry  # your LLMs with hasKey:true
curl "http://127.0.0.1:3000/api/vault/search?q=test"   # vault reachable; after this, data\embeddings-cache.json should appear (semantic RAG active)
```

Then the human test: chat with Claude ("Save to shared memory: setup test from
<machine>"), and on your other machine ask any agent "what was just saved to
memory?" — vault sync + shared memory proven end-to-end.

## Day-to-day rules

- **Code updates**: `git pull && npm run build`, then restart the server
  (`stop.cmd`, then the VBS or a reboot). The running server keeps serving old
  code until restarted.
- **Vault edits sync; `data/` doesn't.** Arena standings and the usage ledger
  (which feed Auto's routing) are per-machine — Auto learns each machine
  separately. That's by design; don't sync `data/` (it holds plaintext keys
  and would conflict-storm).
- **Dev work**: run `stop.cmd` before `npm run dev` (port conflict). If dev
  serves stale CSS/JS after big edits: `rm -rf .next/dev` and restart.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Claude/Hermes show offline right after boot | Cold-boot probes are slow; they retry (failures cached only 60s). Wait ~1 min. |
| LLM answers 401 / 402 / 429 | Bad key / no credit (DeepSeek is prepaid) / rate limit. Pencil icon to fix the key. |
| Semantic search not improving results | Is Ollama running (`ollama ps`)? Did you pull `nomic-embed-text`? Any embed failure disables the layer for 10 min, then it retries. |
| "vault not found" or empty RAG | `VAULT_DIR` in `.env.local` must point at the folder that **contains** `Agentic OS/`. |
| Two Telegram replies per approval/schedule | You broke the PRIMARY rule — disable the gateway/schedules on one machine. |
