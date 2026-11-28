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
  `machineLoad.ts` (CPU / memory / commit / GPU / biggest processes each minute,
  carried by the heartbeat; feeds Health, run placement and Run somewhere),
  `fleetPause.ts` (one vault flag that holds every machine's autonomous work),
  `machineSetup.ts` (Fleet -> Setup: each machine's MCP servers, plugins, skills, CLI
  versions, Ollama models as names only; MCP server / plugin off-on through Claude's own CLI),
  `skillCopy.ts` (Fleet -> Setup -> copy one of your own skills to another machine: pack, check, stage, swap),
  `accountUsage.ts` (Fleet -> Accounts: meters added up per login fingerprint; Claude's
  "you've hit your limit" lines; `withAccountLimits` for placement and Run somewhere; pure, tested),
  `remoteLog.ts` + `remoteCheck.ts` (Fleet -> Remote actions: every cross-machine request logged on
  both ends, shared in the vault, cross-checked for requests the named sender never sent),
  `fallback.ts` + `fallbackPlan.ts` (a reply / new session whose plan hit its limit carries on with the
  next ready tool, conversation included; `fallBack` in sessionActions.ts; plan is pure, tested),
  `acpAgents.ts` / `acpPresets.ts` / `acpClient.ts` / `acpPolicy.ts` / `acpStore.ts` (Agent Client
  Protocol agents as session tool "acp": per-machine commands, the JSON-RPC client, what they may do,
  and Mission Control's own record of their threads), `localModel.ts` (the local model that is running),
  `runPlacement.ts` `pickLocalMachine` + job mode "local" (another machine's local model for a run's
  routine text task; rule 42),
  `github.ts` + `githubReport.ts` + `githubDocs.ts` (/github: every repository on the owner's GitHub
  accounts, changes, waiting-on-you and Claude-written reports; rule 44),
  `repoTasks.ts` + `repoTaskRules.ts` (/work: the tasks the repositories mention, assigned to the owner or
  the fleet and started from there; rule 45),
  `levelup.ts` + `levelupRules.ts` (LevelUp hand-offs: the owner's planning app hands tasks and projects to
  the fleet, approved before they run, filed by client / personal area; rule 46),
  `appearance.ts` (preset options as data-* attributes) + `lookCustom.ts` (the free-form look: any colour,
  installed font, zoom, radius, background picture, menu order / names / hidden, saved looks; its CSS builder is
  self-contained because the pre-paint boot script embeds its source; every value validated:
  scripts/test-look.mjs), `fleetLook.ts` (a look pushed to every machine: vault Cluster/look.json, served at /api/look,
  applied once per push by components/FleetLookSync.tsx unless the browser opted out; cleaned on both ends),
  `talos.ts` + `fleetSnapshot.ts` + `talosNotify.ts` + `telegramFailover.ts` (Talos on Telegram controls
  the whole fleet: snapshot, ask, get, confirm cards for any change, notifications, digest, failover; rule 47),
  `team.ts` + `teamParse.ts` (Command -> Team: named teammates in their own sessions, @mentions and
  "@Name: task" hand-offs, settled by the scheduler's `teamTick`),
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
31. **Memory on Windows means the COMMIT charge, and a missing number is not a full one.**
    Raider18 crashed at its commit limit with 20 GB of RAM free, so lib/machineLoad.ts
    measures commit (RAM + page file) from `Win32_PerfFormattedData_PerfOS_Memory`.
    `Win32_OperatingSystem.FreeVirtualMemorySize` came back EMPTY and read as "100% full"
    when the counters said 80%: treat a missing value as unknown, and cross-check a new
    system metric against a second source before acting on it. MEM_WARN / MEM_FULL live
    in the pure lib/runPlacement.ts so its test covers them; a load older than 5 minutes is
    unknown, never "avoid".
32. **The fleet pause holds work nobody is watching, not work someone just asked for.**
    `isPaused()` (lib/fleetPause.ts, a vault file read fresh each time) gates the master's
    AI-starting duties, `runsTick` (commands still apply) and, in the pump, ISOLATED jobs
    and checks (project-run work). Replies, new sessions, Run somewhere, chats and
    missions started by hand still run, and updates still run (pause -> update -> resume).
    A new background duty that starts AI work must check `isPaused()` too.
33. **Change another tool's configuration only through its own CLI, and share only names.**
    Claude Code rewrites ~/.claude.json constantly, so Fleet -> Setup never edits it:
    `claude mcp remove -s user` after saving the definition to data/mcp-parked.json, `claude
    mcp add-json -s user` to restore it exactly, `claude plugin disable/enable -s user` for
    plugins (a plugin-provided MCP server goes with its plugin). The shared inventory
    (Agentic OS/Cluster/setup/) carries names, kinds, command FILE names and versions:
    never args, env or headers, which hold keys. A setup change is a session job (mode
    `setup`) with access "edit": another machine may make it only when that machine allows
    file edits. Test with a throwaway server, not the owner's (verified: definition and
    env restored byte for byte).

34. **A login's limits are the account's, not the machine's.** Four machines on one Claude login share one
    allowance, so meters carry `account` (a 12-hex hash of the account id: `accountUuid` from
    ~/.claude.json, `tokens.account_id` from ~/.codex/auth.json, read alone; never an email or token)
    and `withAccountLimits` (lib/accountUsage.ts) makes a limit seen on one machine count on all of them
    for placement and Run somewhere. Claude Code records no usage figure, only the moment a limit is hit
    (an `"error":"rate_limit"` line with "resets 6:10pm (Zone)"), so that is what the Claude meter uses;
    the reset is the first such clock time AFTER the line. Test: scripts/test-account-usage.mjs.
35. **Log a cross-machine action on both ends, and trust neither end alone.** Requests can arrive through
    the vault, which anything syncing it can write. `acceptRequest` logs every request ("in", carried out
    or refused), `startJob` / `decideFleet` / the copy route log what was sent ("out"), and
    `crossCheck` (lib/remoteCheck.ts, pure, tested by scripts/test-remote-log.mjs) flags an "in" whose
    named sender's own log, recent and reaching back far enough, has no matching "out". The log is
    append-only JSON lines, and "changed since last shared" is the FILE's time, not a flag: route
    handlers write it, the scheduler's instance publishes it (rule 1). A new remote endpoint that acts
    must log too.
36. **A copied skill is untrusted input that may contain scripts.** It travels only as a setup job with
    access "edit" (the receiving machine must allow file edits), is checked on arrival (name pattern, no
    absolute paths, no "..", no links, file and size caps, SKILL.md present), written to a staging folder
    outside ~/.claude/skills and moved into place in one step. A different skill of the same name is
    replaced only when asked and kept in ~/.claude/skills-replaced (outside the skills folder, so Claude
    doesn't load it). The package rides on the request only and is never stored in the job store.

37. **A fallback carries the conversation, never the credentials, and never for a run's workers.** `execute()`
    in lib/sessionActions.ts calls `runTool`, and only an error that `isLimitError` (lib/fallbackPlan.ts)
    recognises moves a reply / new job to the next step of THIS machine's data/fallback.json order whose
    `stepReady` is true. The first message is `handoffPrompt` (who it replaces and why, the history newest
    first within a budget, saying what was cut: rule 18, then the message). `isolated` jobs (project-run
    workers) never fall back: runs place their own tasks. The local model only for answer-only jobs, with a
    6,000-character prompt and no memory written (rule 23). The job keeps its `tool`; `fellBack` says who
    answered, and travels in `resultOf` so the requesting machine sees it.
38. **"Send when free" waits on the machine that has the session, and only a machine that says it can.**
    `whenFree` replies stay "queued" with a `waitReason` until `waitReasons()` finds nothing ahead of them
    on the same key, the session ended, and its meter not limited; then they continue the session (no
    fork). They expire after 24 hours, and the requester's 30-minute expiry is stretched for them. A remote
    target must advertise `queue` (QUEUE in lib/sessionShare.ts, rule 25): an older one would drop the
    field and fork at once. Bump QUEUE if the contract changes.
39. **An ACP agent is named by id; its command is the machine's own.** data/acp-agents.json is changed only
    through the machine's local /api/hub/agents-setup; other machines see `acpAgents` (id + label) and a
    request naming an id that isn't switched on is refused (rule 21's reasoning). Mission Control never
    calls ACP `authenticate` (Gemini offers a billed API key) and strips API keys and GOOGLE_CLOUD_PROJECT /
    GOOGLE_GENAI_USE_VERTEXAI from the agent's environment. Permission answers come from
    lib/acpPolicy.ts: allow ONCE only (an "always" may be saved in the agent's settings), commands /
    deletes / unknown kinds refused at every level, fs reads and writes inside the session folder only.
    Resolve the command to an absolute path (`resolveAcpCommand`): the server's PATH is not your
    terminal's, and `where gemini` also lists npm's extensionless script that cmd.exe can't run.
    And a CLI installed with `npm install -g` from a terminal INSIDE the Claude desktop app (MSIX) lives in
    that app's private %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming
pm: it works in Claude Code's
    shell and doesn't exist for the server (`fs.existsSync` false). Raider18's Gemini CLI is one.
    Test: scripts/test-fallback.mjs; a mock agent is the quickest end-to-end check.
40. **Team hand-offs are background work: one instance sends them, the pause holds them, a cap ends them.**
    Only the scheduler's `teamTick` settles teammates' jobs and sends hand-offs (rule 1: two instances would
    send one twice); hand-offs are held while `isPaused()` (rule 32) and stop after MAX_HOPS without the
    person; a teammate never hands to itself. Messages to a teammate with a session are `whenFree` replies,
    so they queue behind each other. A fallback moves the teammate to the new session (`fellBack`, not local).

41. **A Node crash on Windows leaves no trace by itself, so start the server bare and read exit codes.**
    libuv calls `SetErrorMode(SEM_NOGPFAULTERRORBOX)` in every Node process (src/win/core.c), so Windows
    Error Reporting is never invoked: no Application Error event, no WER entry, and LocalDumps (set for
    node.exe on Raider18, 2026-11-27) don't fire either; verified with a real 0xC00000FD test crash. And a
    child libuv spawns sits in a job with KILL_ON_JOB_CLOSE (src/win/process.c), so under `npm start`
    npm's death killed the server too. server.cmd therefore runs `node node_modules\next\dist\bin\next
    start` directly. Raider18's server died six times (2026-11-14..26) with 0xC0000409 (fail-fast),
    nothing logged, no Node report, memory fine, not tied to jobs or the watchdog; Node was 24.15.0
    (libuv 1.51.0), now 24.22.3 (libuv 1.52.1). A debugger is the only thing that sees such a crash, so
    when Sysinternals ProcDump is installed (%LOCALAPPDATA%\Programs\Sysinternals\procdump64.exe;
    Raider18 since 2026-11-27, licence accepted by the owner) `startCrashMonitor` in lib/serverLog.ts
    attaches it to the server at start (`-e -ma -n 1`, detached; dumps in %LOCALAPPDATA%\CrashDumps\node,
    newest 3 kept; the watchdog logs a fresh one). NEVER force-kill procdump64.exe: as a debugger, its
    death ends the server too (tested). Stop it with `procdump64 -cancel <server pid>`, or
    MC_NO_PROCDUMP=1. Editing server.cmd while it runs: cmd.exe reads a batch file live, so restart the
    server after changing it (once it ran the new line by itself).

42. **A local model is loaded only where it fits, and lent only by id-less request.** On Windows Ollama
    commits ~1.4x a model's size even with every layer on the GPU (gpt-oss:20b: 69% -> 94% commit on
    Raider18, 2026-11-27); inkling-2-mini (18.3 GB) would have crashed it. `localModelFits`
    (lib/localModel.ts) allows a load only if commit stays below MEM_FULL afterwards (or the model is
    loaded already), and EVERY place that loads one checks it: a run's own local worker, a "local" job
    (on acceptance and again before loading), the fallback's local step. Another machine's model is used
    through job mode "local": answer only, the target's OWN model choice (the request names none), no
    tools or memory (rule 23), one at a time per machine, held by the fleet pause. A machine advertises
    `localModel` {model, gb, fits} in its summary (that field is the capability: older versions don't
    send it); `pickLocalMachine` (lib/runPlacement.ts, tested) takes LAN first, then most free memory,
    never one at MEM_WARN, busy with a local task, saying it doesn't fit, or avoided. Spreading runs only.
    Chats and Auto that pick a local model don't check this yet.

43. **Keep the owner's change write-up current.** docs/Mission-Control-Changes.docx is the owner's running
    summary of what changed and what is waiting on them. It is generated by docs/changes/build-changes-doc.mjs
    (all wording lives in that script; the commit appendix comes from git). When the owner asks for a change
    to the app, add it there (SECTIONS, WAITING, HISTORY, META.updated), run the script, and commit both
    files with the change. The repository is public: no emails, keys, tokens or account ids in it.

44. **The GitHub dashboard reads other people's words: the writer gets no tools, the data stays here.**
    lib/githubReport.ts collects with the GitHub CLI's own sign-ins (`gh auth token --user`, held in memory
    for one collection, never stored or logged; gh must be signed in from a NORMAL terminal, not the Claude
    app's). Commit messages, issues and documents may contain instructions, so the per-repository (Haiku) and
    overview (Sonnet) reports run with every Claude tool disallowed, MCP off and an empty working folder,
    with the data fenced as data; nothing they write is acted on. data/github-report.json is local only:
    private repositories never go to the vault. Without a sign-in only public repositories are listed and the
    overview must say details are missing (it once called a busy week "no activity"). Document reading
    (status-doc names, .docx text, "waiting on you" sections) is pure: scripts/test-github-docs.mjs.

45. **Work hands repository tasks to the fleet; Mission Control proposes, the owner (or a switch) starts.**
    lib/repoTasks.ts syncs tasks from each GitHub report (status-document items, GitHub's own owner signals,
    open issues) under stable ids (repository + source + normalized words), so status, assignee and notes
    survive re-syncs; one that leaves its document is flagged, never deleted. Assigning by rules
    (lib/repoTaskRules.ts, tested): an owner-only action must START with its verb ("Sign in…", "Paste…",
    "Merge #100 / … change"), or ask the owner to provide a secret, because the same words inside a feature
    ("Merge variable resolution… job changes", "password-policy section") are development work; a re-run
    redoes only Mission Control's own picks, never the owner's. Where a repository lives: this machine's
    folders by git remote, others' by folder/project name. Smart assign asks Claude with no tools. Starting
    is an ordinary session job or Team message (answer only unless set otherwise and allowed there);
    `workTick` (scheduler instance only) follows it to Review. Auto-start is off by default, one at a time,
    two running at most, held by the fleet pause. Local data only (private repository text).
    Fresh code before work: Raider18's usip folder was 636 commits behind GitHub and a task answered from it.
    `freshenFolder` (lib/gitFresh.ts, tested on throwaway repos: scripts/test-git-fresh.mjs) fetches and
    fast-forwards a folder on this machine before Start, ONLY when nothing local can be lost (no uncommitted
    tracked changes, no local-only commits); otherwise an edit task is refused and an answer task is told its
    copy may be old. Folders on other machines can't be checked from here: their prompt says to compare first.
    Git note: after `gh auth login` for two accounts, Git Credential Manager kept only the last one, so this
    repository has a local credential helper (`gh auth token --user igrant9679`) in .git/config.

46. **LevelUp hands work in; Mission Control calls out, and runs nothing the owner hasn't approved.** LevelUp
    (the owner's planning app, a cloud service; repo igrant9679/levelup-second-brain, its side in
    server/_core/fleet.ts) keeps each hand-off with a state. Mission Control stays on 127.0.0.1: the
    scheduler's `levelupTick` (lib/levelup.ts, every minute, only where data/levelup.json holds a key — a
    credential: never shared, logged or put in the vault) CALLS LevelUp's /api/fleet/v1 and moves items on
    with the pure rules in lib/levelupRules.ts (scripts/test-levelup.mjs): propose a plan → wait for approval
    (in LevelUp, or Work → Approve) → start it as a Work task (origin "levelup"; `startTask` refuses one
    without `approval: "approved"`; Start-all and auto-start skip them) → report the result → mirror accept /
    cancel / send back. Placement: a repository the task names (its best place), else the area's work folder
    (data/areas.json, chosen from folders the fleet already uses), else this machine's HOME FOLDER, ANSWER
    ONLY: with no folder chosen nothing may change files anywhere. Only the machine that claimed an item moves
    it on (LevelUp enforces it too). The fleet pause holds starts (a hand-off may be planned for a day nobody
    watches). Each pass also sends LevelUp the owner's Work items (to do / to review, with their area) for
    its Fleet panel: that is private repository text going to the owner's own LevelUp account, by design.
    Areas: LSI Media, CommunityForce, MeYouSocial (+ more in data/areas.json) and Personal; repositories get
    theirs from data/areas.json, else an obvious name match (`areaOfRepo`).

47. **Talos controls everything, through one door, and every change needs the owner's yes.** The owner wants
    full control of the fleet from Telegram, "as if using Mission Control directly", with a Telegram "yes" as
    the only confirmation (no PIN; Talos's own command access is NOT to be restricted). /api/talos
    (lib/talos.ts): `ask` (Claude, no tools, over `buildSnapshot`, lib/fleetSnapshot.ts), `get` (any GET
    endpoint, here or on another machine via peer GET /peer/talos-get), `act` (any POST/PUT/PATCH/DELETE →
    a confirm card: single-use, 10 minutes, nothing runs yet) and `confirm` (the owner's reply relayed word for
    word; only a plain yes runs it, `isYes`; claimed before running so it can't run twice). The manual
    (`buildManual`) is generated from app/api/**/route.ts: doc comments PLUS the body fields, actions and query
    parameters read from each handler's code, so a new endpoint is usable by Talos at once — keep route doc
    comments current. A card for another machine runs there through POST /peer/talos-call only where that
    machine allows edits from the fleet (remoteReplies "edit"), logged on both ends (kind "talos"). Cards can't
    call /api/talos itself. Local-only data (Work, the GitHub report, LevelUp link) is fetched from its machine
    over the LAN (`localPart`, GET /peer/talos-local) and never put in the vault. Notifications + morning digest:
    lib/talosNotify.ts (`talosNotifyTick`, master only, each event once, quiet hours held for the digest,
    approvals/health left to their existing alerts). Failover: lib/telegramFailover.ts (a standby starts its
    OpenClaw gateway only after the primary's heartbeat is `minutes` old, stops it as soon as it returns;
    never on the primary; the standby must be prepared by the owner with its gateway stopped). Settings:
    data/talos.json. Pure parts tested: scripts/test-talos.mjs. Talos learns all this from
    ~/.openclaw/workspace/TOOLS.md on the Telegram machine ("Mission Control: full control").
    JARVIS (/jarvis) has the same control: `op: "command"` (`commandFleet`) turns any request in plain words into
    an answer or ONE confirm card (Claude, tools off, over the snapshot + manual, up to 4 reads first); JARVIS
    reads the card out and a spoken or typed yes / no confirms or cancels it (anything else cancels it and is
    taken as a new request). Talos may use the same op instead of choosing endpoints itself.

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
