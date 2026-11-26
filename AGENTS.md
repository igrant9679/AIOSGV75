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
| Talos (OpenClaw) | command agent | `openclaw agent … --message {input}`; also the Telegram gateway (bot pairing, approval replies). Only ONE machine may poll the bot, but it need NOT be the master — approvals are vault-shared |
| Hermes | command agent | Nous Hermes CLI, one-shot `-z {input}`; absolute path from `.env.local` |
| DeepSeek / any API LLM | OpenAI-compatible | `/api/llm` streaming agentic tool loop (`lib/llmTools.ts`: search_vault, read_note, save_memory, goals, journal, request_mission) |
| Llama | local LLM | Ollama at `http://localhost:11434/v1`, keyless (`isLocalEndpoint()` in `lib/registry.ts`) |
| Codex | command agent | `codex exec --skip-git-repo-check {input}` (needs one-time `codex login`) |
| Auto | virtual router | `lib/router.ts` picks a real agent by task tier, arena win-rate, cost, health; on an error climbs the cost ladder, Claude last (`/api/auto/drill` proves it) |

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
  `vault.ts` (Obsidian read/write + scaffold + the Rules note),
  `rollup.ts` (weekly roll-up notes + Archive, master duty),
  `conflictCopies.ts` (sweeps OneDrive copies of generated notes),
  `projectChecks.ts` (the per-machine list of commands a run may use as proof),
  `runs.ts` (project runs: plan → real sessions as workers → checks → review →
  escalate → deliver; state in the vault, advanced by the machine that
  started the run), `runPlacement.ts` (which machine a task runs on: pure
  rules, tested without a fleet), `runLessons.ts` (attempt notes → per-project
  lessons + the worker record, given to the next planner), `runGit.ts` (a
  branch per run, one commit per accepted edit task, the diff for reviewers),
  `nousModels.ts` (cheapest Nous model for a Hermes run),
  `selfUpdate.ts` (Fleet -> Versions: build stamp, how far each machine is behind
  GitHub, wait-until-idle, the detached `scripts/self-update.ps1` / `.sh`),
  `sessionTools.ts` (the registry of session tools) + `sessions.ts` /
  `hermesSessions.ts` (readers) + `sessionActions.ts` (reply / new / stop,
  locally and on other machines),
  `registry.ts`, `usage.ts`,
  `arena.ts`, `evals.ts`, `llmTools.ts`, `telegram.ts`, `guideContent.ts`,
  `helpContent.ts` (the Help panel's per-page help, how-tos and glossary:
  give every new page an entry in `PAGE_HELP`; `components/HelpDrawer.tsx`
  renders it, `/api/help/ask` answers questions from the guide).
- Operator pages beyond chat: `/tasks` (kanban + Orchestrator panel),
  `/schedule` (cron calendar), `/library` (vault doc browser), `/graph`
  (canvas force-sim knowledge graph — hand-rolled, no graph lib).
- `components/` — UI: `store.tsx` (global chat/mission state, OS-verb
  harvesting), `Shell.tsx`, `ChatThread.tsx`, `SettingsSection.tsx`,
  `GuideSection.tsx`, `Markdown.tsx` ([[wikilinks]] → obsidian:// links).
- `data/*.json` — runtime state (git-ignored; registry.json holds plaintext
  API keys). The installers add the local chat model to it through
  `scripts/register-local-model.mjs` — parse and rewrite whole, never patch
  the file as text, and never overwrite one that will not parse. `.env.local` — machine config (`VAULT_DIR`, `EMBED_*`,
  `OPENCLAW_CMD`, `HERMES_BIN/CMD`).
- Vault: `VAULT_DIR` → app writes under `Agentic OS/` (Memory.md, Goals.md,
  Journal/, Chats/, Missions/, Agents/, Workspaces/<name>/, Guide.md, Home.md,
  Rules.md, Weekly/, Archive/).

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
8. **Every CLI child gets `cleanEnv()` (lib/runners.ts), never `process.env`.**
   It strips `CLAUDE_*`/`ANTHROPIC_*` so a server launched from inside a Claude
   Code session doesn't poison CLI auth, and — subscription only, the default —
   every provider API key (`API_KEY_VARS`), so a key in `.env.local` for Studio
   can't switch Claude or Codex to per-token billing. `MC_ALLOW_API_KEYS=1`
   opts a machine out. A new spawn site that passes `process.env` reopens that.
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
14. **A cap that fills in directory order is a silent blind spot.** The vault
    index once stopped at a global passage cap inside `Sessions/`; Missions,
    Journal, History, Chats and Agents contributed zero passages and search
    still "worked". The index is budgeted per folder, newest first
    (`FOLDER_BUDGETS` in `lib/vaultSearch.ts`); `GET /api/vault/rollup` reports
    passages per folder. Give any new high-volume folder its own budget.
15. **Agent behaviour lives in the vault, not in code.** `Agentic OS/Rules.md`
    is injected whole into every call (`readRules()` in `lib/vault.ts`); only the
    OS-verb tag syntax (`VERB_HINT`) stays in code, because the harvester parses
    it. Keep literal verb tags out of any default rules text — an agent quoting
    its rules in a chat reply would have the quoted tag executed.
16. **Never ask "is it Claude?" and treat everything else as Codex.** The
    session layer did that in ~50 places, plus four regexes that only accepted
    `claude:` / `codex:` keys, so a third tool would have been labelled,
    resumed and billed as Codex with no error. Tools live in ONE registry,
    `lib/sessionTools.ts` (client-safe): use `toolLabel` / `toolShort` /
    `toolRunsOn` / `resumeCommand` / `asSessionTool` / `SESSION_KEY_RE`, and
    capability flags (`canFork`, `canMove`) instead of naming a tool. Adding a
    tool = a registry entry, a session reader (`lib/hermesSessions.ts` is the
    pattern for a tool that keeps a database instead of files), and a branch in
    `execute()` in `lib/sessionActions.ts`.
17. **A CLI that cannot stop and ask must be limited by what it is given.**
    Hermes's non-interactive modes auto-approve, so access levels are enforced
    with `-t <toolsets>` (`HERMES_TOOLSETS`; an explicit list replaces the
    configured one — checked in Hermes's source, not assumed). Prompts go as an
    argument with `shell: false`: through cmd.exe a newline ends the command.
18. **Whoever judges or builds on a result must see all of it.** The first
    project run clipped a worker's output at 7,000 characters for the reviewer;
    the reviewer saw "…(shortened)", took it for the worker's own truncation and
    rejected good work. Pass results whole, or say in the prompt that the cut is
    the system's. And tell an assembler how each piece was checked — left out,
    it reported reviewed work as unreviewed.
19. **Cheap models need a leash, not just a lower price.** A free model given a
    research task made 66 web calls in nine minutes. Hermes workers get a
    turn cap (`HERMES_TURNS`) and every run task a time budget
    (`TIME_BUDGET_MS`); past it the worker is stopped and the task escalates.
20. **Auto must never reach for a pay-per-token model on its own.** Registry
    LLMs with a key are out of `routablePool()` unless `autoRoute` is set.
    Before this, one benched Claude left a single Grok API key as Auto's whole
    pool and every Auto task went to it.
21. **A run may name a check; only the machine may define one.** Check commands
    live in `data/project-checks.json` on each machine and are changed only
    through that machine's `/api/runs/checks`. Never read a command from the
    vault, a plan, a job or another machine's request: the vault is writable by
    anything that syncs it. `acceptRequest` refuses mode `check` outright.
22. **A headless Claude that asks permission waits ten minutes for an answer**
    (`HEADLESS_WAIT_MS`, lib/permissions.ts). A reviewer that tried to "just run
    the tests" sat there until its own five-minute limit. Planners and reviewers
    run with `readOnly` (`--disallowedTools Bash,…`) in the project folder: they
    read the real files and cannot stall. Timeouts must `killTree`, or the real
    process outlives the shell that was killed.
23. **Small local models read the shared brain; they do not write to it.**
    `WRITE_TOOLS` (lib/llmTools.ts) are withheld from local endpoints and
    refused at execution; the OS-verb hint is left out of their system prompt.
    As a project-run worker (`localWork` in lib/runs.ts) it gets one plain
    completion with `injectMemory: false` and no tools, only for routine
    answer-only tasks with no web or checks, once per task, and its failure
    does not use up an attempt. Keep its prompt short (`LOCAL_PROMPT_MAX`):
    Ollama sizes context from the machine's memory and cuts long prompts
    silently. Tell it plainly not to repeat itself — told to end with
    "RESULT: what you produced", gpt-oss pasted its whole answer twice and was
    rejected for it.
24. **The vault is a OneDrive folder: a rename can be refused.** While a file is
    being uploaded or read, `rename` onto it fails with EPERM/EBUSY for a moment.
    Use a retrying replace (`replaceFile` in lib/runs.ts) for anything rewritten
    often, or a step is silently lost.
25. **Send work only to a machine that says it can do it.** Reachable is not
    enough: a machine on older code accepts a job and silently drops fields it
    doesn't know, such as a run's model choice and turn cap, so a Hermes task
    there could run on a paid model with no leash. Run tasks go only to machines
    whose shared summary carries `runWorker` (`RUN_WORKER` in
    lib/sessionShare.ts); bump it when the contract a worker must honour grows.
26. **A protocol marker is not part of the deliverable.** Workers end with a
    "RESULT:" line; a reviewer read it as part of a four-line poem and rejected
    good work, twice. Reviewers are told the marker is ours. And a rework reply
    to an answer task REPLACES the old result (the rework prompt asks for the
    whole corrected answer); appending it showed the reviewer two copies. Only
    edit tasks append, because their real work is on disk.
27. **A run never commits the owner's own work.** A branch is made only on a
    clean working tree (lib/runGit.ts); nothing is pushed, merged, reset or
    deleted; hooks run. Edit tasks take turns in a folder, so each task's diff
    and commit hold only its own changes.
28. **A headless Claude starts every MCP server the owner has.** On Raider18
    that included two WanGP servers reserving ~3.9 GB of memory each, per
    `claude -p`. A planner, a worker and a reviewer at once pushed the PC to its
    commit limit and Mission Control and Ollama crashed (0xC0000409). Mission
    Control's own work passes `--strict-mcp-config` (`noMcp` in runAgentText,
    `isolated` jobs, Help); chats, missions and schedules keep the owner's
    servers because they may use them.
29. **A server that dies leaves its CLI children running.** On Windows the
    recorded pid is the shell, which dies too, while `claude` (its child) kept
    running for fifteen minutes in a project folder, allowed to edit files, with
    nobody to read its output. Jobs carry `serverPid`; a new server stops
    the ones an earlier process left running, found by parent id and checked by
    command line and start time (`orphanProcesses` in lib/sessionActions.ts).
30. **An update must outlive the server it replaces, and must not cut anything off.**
    Fleet -> Versions -> Update is a session job (mode `update`), so it travels and is
    re-checked like a reply. The target waits until `updateBlockers()` is empty (rule 11)
    and holds new jobs meanwhile; only the scheduler's module instance starts it, because
    only that instance can see project-run steps in flight. The work is a DETACHED script
    (it is what kills the server) that reports through `data/update-status.json`; the job
    is settled by the server that comes back, when it is serving the new commit
    (`data/running-build.json`, written at start from the build stamp
    `.next/mc-build.json`). Jobs of mode `update` are exempt from the orphan sweep. A
    request names no code, command or address: the target pulls its own branch from its
    own remote, and a failed build goes back with `git reset --keep`. Bump `SELF_UPDATE`
    when the contract changes. Testing tip: stepping a folder back past the commit that
    added a script removes the script too.

## Dev cycle (production server auto-starts at login)

- The **prod** server starts at Windows login via the "Mission Control Watchdog"
  Scheduled Task (`conhost --headless` → `watchdog.ps1` → `server.cmd` →
  `npm start -- -H 127.0.0.1`); the same task re-checks every 5 minutes. No
  .vbs launchers: Smart App Control blocks them.
- Run `stop.cmd` **before** `npm run dev` (port conflict). Note `stop.cmd`
  ends with a `pause` — don't chain it in scripts without piping input.
- After code changes: `npm run build`, then restart (stop port 3000, then
  `Start-ScheduledTask 'Mission Control Watchdog'`) so the boot server serves
  the new code. The running server keeps old bundles until then.
- Dev serving stale CSS/JS after big edits → `rm -rf .next/dev`, restart dev.
- Verify health: `/api/system`, `/api/agents` (cold-boot probes can take ~45s).

## Multi-machine model

Clustering is **ON** (2026-08): roles live in per-machine `data/cluster.json`,
coordination in vault `Agentic OS/Cluster/` (lease + heartbeats). The MASTER
runs schedules, watchers, nudges, pipeline sync, the weekly profile refresh and
approval launches — everything behind `clusterTick()` in `scheduler.ts`.

**The Telegram gateway is independent of the master.** Approvals are vault-backed
(`Agentic OS/Approvals.json`), so any machine can raise or answer one and the
master launches the mission. Put the gateway on the always-on machine; make the
fastest machine master.

Shared via the vault: memory/RAG/goals/journal/tasks/**approvals**/profile.
Per-machine: `data/*.json` (incl. `cluster.json`), `.env.local`, CLI logins.

**Every machine that can become master needs `TELEGRAM_BOT_TOKEN` in
`.env.local`** — the master is what sends, and without it notifications fail
silently while runs still record success. Details: `SETUP-NEW-MACHINE.md`.
