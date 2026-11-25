# Project runs — design

**Status: phases 1 and 2 are built (`lib/runs.ts`, `lib/projectChecks.ts`, the Runs page) and have completed real runs, including runs whose work had to pass a real test command. Phases 3 to 5 are design. Written 2026-11-24.**

> **Phase 2 as built, and what its runs taught.**
>
> - **Checks** are per folder, per machine (`data/project-checks.json`), set on that machine's
>   Runs page, with a *Try it* button. A plan names them on tasks that edit files; Mission
>   Control runs them after the worker finishes; only passing work is reviewed; a failure
>   returns to the worker with the command's own output. Verified both ways in a sandbox
>   project: pass first time, and fail → sent back → fixed → pass.
> - **A command can only come from the machine's own list.** An unlisted name, an injected
>   `test && whoami`, a multi-line command and a folder that is not a known project were all
>   refused. Checks do not run for another machine's request at all.
> - **The reviewer stalled on a permission prompt.** Claude, reviewing, tried to run the tests
>   itself; the app's permission feature held that request for ten minutes waiting for a
>   person. Planner and reviewer now run read-only in the project folder: they read the real
>   files and cannot stall. That run was delivered honestly as "checks passed, not reviewed".
> - **A rework reply replaced the worker's whole result** with a description of the fix, so the
>   next reviewer saw no sign of the original task. A reply is now appended to what came before.
> - **OneDrive refused a write to run.json once** (EPERM on rename). State writes now retry.
> - **The free model completed two of three coding tasks by itself** once checks told it
>   exactly what was wrong; the third was moved up to Codex.
> - **Still not done in phase 2:** checks when a run works on another machine; evidence of
>   *what changed on disk* (a diff) for folders that are git repositories.

> **What phase 1 changed from this design, and what the first run taught.**
>
> - **The machine that starts a run advances it** (`driver`), not the cluster master as §2.2
>   says. The master was on older code and would never have picked a run up, and this way a run
>   needs one machine up instead of two. The rest of §2.2 holds: one writer per file, an
>   idempotent tick, the job id written before the job starts. Other machines, and that machine's
>   own API routes, ask for changes through the run's `commands/` folder.
> - **Dependencies between tasks came early** (planned for phase 3): a task starts when the
>   tasks it depends on are done and is handed their results.
> - **Cost tiers (§2.4a) came early** too, on one machine: routine → Hermes on a free Nous
>   model, standard → Codex, hard → Claude, smaller Claude models for smaller work, escalation
>   after two rejections at a tier.
> - **The free Nous models can search the web.** Tested: all four free models answer, and a free
>   model given the web toolset made real `web_search` / `web_extract` calls. So "the cheapest
>   model with internet access" is normally still a free one.
> - **A cheap model needs a leash.** The first research task made 66 web calls in nine minutes
>   on a free model. Hermes workers now have a turn cap and every task a time budget.
> - **The engine's own clipping caused a false rejection.** The reviewer was shown 7,000 of
>   10,500 characters, read the cut as the worker's, and rejected it. Results now travel whole.
> - **Still true of phase 1:** review is a model reading text. Nothing is executed. The
>   delivery says so on every run.
> - **Known gap:** a Codex worker's new session id is not captured, so its rework goes to a
>   fresh Codex session (given the rejected output and the review) rather than the same one.
>   Hermes and Claude rework in place.

The goal, in the owner's words: *give a large project or task to Auto or Hermes to
plan, distribute, manage, test, learn, iterate and deliver* — Mission Control as the
place where work is orchestrated, shared out and brought back.

This document says what exists, what is missing, and what to build in what order.
Every "exists" below was read in the code, not assumed.

---

## 1. Where we start

`lib/orchestrator.ts` already runs a chief-of-staff loop: Claude plans, workers run,
Claude reviews, failed work is redone, Claude assembles, the result is archived to the
vault and tracked on the board. It is the right shape and the wrong weight class:

| Wanted | Today (`lib/orchestrator.ts`) |
| --- | --- |
| Hand the project to Auto or Hermes | The planner, reviewer and assembler are hardcoded to Claude. Auto or pinned agents only do subtasks. |
| Plan | At most 5 subtasks, one level deep, and the prompt requires them to be **independent** — no task can build on another. |
| Distribute | Everything runs on the machine where it was started. `rankMachines()` exists and is not used here. |
| Manage | A board card and Telegram messages. State is held by a live process: a restart or a change of master kills the run, and nothing resumes it. |
| Test | "Review" is a second model reading the first model's text. Nothing is executed. |
| Learn | Nothing is carried from one run to the next. |
| Iterate | Up to 2 reworks, each a fresh one-shot call that is handed its old output as text. |
| Deliver | One assembled text document. |

**The one gap everything else hangs on:** a worker is a one-shot text call
(`runAgentText`). It has no folder, edits no files, runs nothing, and forgets
everything when it returns. A project needs workers that are *sessions*.

That piece now exists. `lib/sessionActions.ts` can start a real session in a
project's folder on any machine in the group, reply to it later with its context
intact, stop it, and read its full thread — for Claude Code, Codex and Hermes, over
the LAN or through the vault, inside each machine's own access setting. A project run
is mostly a matter of driving that from a plan.

---

## 2. What a project run is

A **project run** is a plan of tasks with dependencies, executed by real sessions on
whichever machines suit them, checked by evidence, and written down as it goes.

```
brief ──▶ PLAN ──▶ (you approve) ──▶ DISPATCH ──▶ CHECK ──▶ REVIEW ──▶ done
            ▲                           │            │         │
            └──────── replan ◀──────────┴── rework ◀─┴─────────┘
                                                        └─▶ escalate to you
```

### 2.1 State lives in the vault

```
Agentic OS/Runs/<date> <slug>/
  Run.md          the brief, the plan as a readable checklist, the current status
  run.json        the machine-readable state: tasks, dependencies, attempts, job ids
  Log.md          one line per event, appended
  Lessons.md      what this run taught (see §2.6)
  Delivery.md     written at the end: what was done, the evidence, what is still open
  tasks/<id>.md   one note per task: its brief, each attempt, the check output, the verdict
```

Why the vault and not `data/`: a run outlives a server process and must survive a
change of master. The existing rule holds — one writer per file. Only the **master**
writes `run.json`; workers report through the job-result files that already exist
(`Agentic OS/Cluster/requests/<host>/results/`). That is the same discipline the
cluster lease and vault-backed approvals already use.

### 2.2 The run is a state machine advanced by the master's tick

Like schedules and `syncExecuting()` in the pipeline: every tick reads `run.json`,
reconciles finished jobs, starts whatever is now ready, and writes back. Each step is
idempotent, and a job's id is recorded **before** it is dispatched, so a crash between
the two is recovered by looking the job up, not by starting it twice.

This is what makes a run resumable. It also removes the current orchestrator's
"in-flight runs die with the server" limit for this feature.

### 2.3 Plan

- **Planner is a choice**: Auto, Claude, Hermes, or any agent. The planner gets the
  brief, the project's folder and recent sessions, the Rules note, and the lessons from
  earlier runs (§2.6).
- **A plan is a graph, not a list.** Each task has: `dependsOn`, a kind (research /
  build / test / review / decide), acceptance criteria, how it will be checked (§2.5),
  the access it needs (answer or edit), and optional hints (tool, machine).
- **Bounded**: a cap on tasks, on depth and on total attempts, set per run. A planner
  that returns no usable plan falls back to a single task and says so, as today.
- **The plan is a checkpoint.** It goes through the existing approval gate
  (`lib/approvals.ts`, vault-backed, answerable from Telegram) before anything runs.

### 2.4 Distribute

For each task whose dependencies are done:

1. **Which tool** — the task's hint, else Auto's router (cost, health, past results).
2. **Which machine** — `rankMachines({ tool, project })`, which already scores on:
   online, accepts work, has the project folder, subscription headroom, how busy it is,
   LAN before OneDrive.
3. **Start it** — `startJob({ mode: "new", … })`. Follow-ups and rework are
   `mode: "reply"` to the *same session*, so the worker keeps what it learned.

A dependent task is handed its predecessors' results (the task notes), not just told
they exist.

Limits that are real today and shape this: 2 runs at once per machine, 20 minutes per
run, and a machine never grants more than its own "Replies from my other machines"
setting. A task that needs more than 20 minutes continues with a reply; a task that
needs edit on an answer-only machine is routed elsewhere or raised to you.

### 2.4a Cost tiers — cheap work to the cheap worker

Every task carries a **tier**, set by the planner and correctable by you in the plan:

| Tier | Typical work | Worker, in order of preference |
| --- | --- | --- |
| routine | look something up, summarise, classify, draft, reformat, simple file edits | **Hermes** on an inexpensive Nous Portal model, or a local Ollama model where a machine has one |
| standard | implement a contained change, write tests, analyse a file set | **Codex** (ChatGPT subscription), **Gemini CLI** once it is signed in |
| hard | plan, design, debug across files, review, assemble | **Claude Code** (Claude subscription) |

Rules that make the tiers safe rather than merely cheap:

- **Escalate on evidence.** A routine worker that fails its check or review twice is
  retried one tier up, not a third time at the same tier. The run records which tier a
  task finished at, and that feeds the next plan (§2.6).
- **Review from above.** The reviewer of a task is always a higher tier than its worker.
- **Subscription headroom shifts work.** When a plan's meter is near its limit
  (`rankMachines` already reads the meters), standard work moves to the other
  subscription or waits; it does not fall through to a per-token API.
- **No per-token fallback without a yes.** A run uses subscriptions and local models. An
  agent added by API key is used only if the run was started with that allowed.

What is true today and has to change for this to work:

- **Auto cannot choose Hermes or Codex.** `routablePool()` in `lib/router.ts` offers
  Claude plus the registry's API-key and local models. Command agents are not
  candidates. Tiered routing for runs therefore needs its own chooser over *session
  tools* (`lib/sessionTools.ts`), not the chat router.
- **Hermes's cost depends on its model, and Mission Control cannot see it.** Nous Portal
  is one sign-in to many vendors' models. Hermes records no cost or token counts for
  Nous runs (every billing column in its store is empty), and this project's own notes
  say Nous inference is prepaid credits, free only on `:free` models. So the routine
  tier pins a model per run (`hermes chat -m <model>`), chosen by the owner from the
  Nous price list, instead of inheriting whatever Hermes's default happens to be.
  Running Claude or GPT models *through Nous* is the expensive way to reach models the
  owner already pays for by subscription, so the routine tier never does.
- **Hermes started from Mission Control has no terminal** (`HERMES_TOOLSETS`). It can
  research, write and edit files; it cannot run a build or a test. Checks (§2.5) are
  run by Mission Control itself, so this limits what Hermes can *do*, not what can be
  *verified*.

### 2.5 Test — evidence, not opinion

The lesson this project has paid for repeatedly is that things report success while
failing. So a task is not done because its worker said so.

- **Checks are executed.** A project declares an allowlist of commands it trusts
  (`npm test`, `npm run build`, `npx tsc --noEmit`, …). A task names the ones that
  must pass. Mission Control runs them itself in the project folder on the machine
  that did the work and records the exit code and the tail of the output. Nothing
  outside the allowlist ever runs.
- **Then a reviewer reads the evidence.** A *different* model from the worker judges
  the result against the acceptance criteria, with the check output in front of it.
- A task with no executable check is marked as **reviewed only** in the delivery
  report, so a reader can tell proved from judged.

### 2.6 Learn

- **Per run**: failures, the fix that worked, and anything the reviewer flagged go to
  `Lessons.md` as they happen.
- **Across runs**: the next plan for the same project is given that file. Lessons that
  look general are *proposed* for `Agentic OS/Rules.md` or shared memory — proposed,
  through the approval gate, never written into the rules unasked.
- **Routing**: which tool passed its check first time, for which kind of task, is
  recorded and fed to Auto's router alongside the arena results it already uses.

### 2.7 Iterate

Check or review fails → reply to the same session with the specific failure → up to N
attempts → then a different tool or machine → then **you**, as a "Needs you" item and
a Telegram message, with the evidence attached. A failure can also send the run back
to the planner to amend the plan, within the run's caps.

### 2.8 Manage

- **Board**: the run is one card; its tasks are cards beneath it (`lib/tasks.ts`).
- **Command → Needs you**: plan approvals, blocked tasks, escalations.
- **Budgets per run**: tasks, attempts, wall-clock, and subscription headroom per tool.
  Reaching one pauses the run and asks; it does not fail silently or push on.
- **Pause, resume, stop** from any machine. Stop reaches running sessions through the
  stop action that already exists.

### 2.9 Deliver

- For a code project, work happens on a branch named for the run, never on the default
  branch. Merging stays yours.
- `Delivery.md`: what was asked, what was done, each task with its evidence (check
  passed / reviewed only / failed), links to the sessions, what is still open.
- A short version to Telegram, the full note in the vault.

---

## 3. What stays as it is

- **The current orchestrator** stays as the quick path for a text deliverable. The
  pipeline's "execute" stage can use either.
- **Every existing boundary**: only folders that sessions on a machine already use;
  each machine's access setting; subscription-only CLI environments; approvals.
- **Mastermind, missions, arena** are untouched.

---

## 4. Build order

Each phase is usable on its own and is verified before the next begins.

1. **Runs that survive.** Vault-backed run state, the master's tick, plan approval,
   tasks executed as real sessions (new + reply) on one machine, board cards, stop /
   pause / resume. Review is still a model's judgement. *This replaces nothing and
   proves the spine.*
2. **Evidence.** Project check allowlists, checks run by Mission Control, an
   independent reviewer, rework by reply, escalation to you.
3. **Distribution.** Dependencies between tasks, machine ranking, budgets and limits,
   continuing a task past the 20-minute run limit.
4. **Learning.** Lessons files, proposals for Rules and memory, routing statistics,
   replanning.
5. **Delivery.** Branch per run, the delivery report, Telegram summary.

Hermes can plan and work from phase 1. Gemini joins as a worker as soon as its sessions
are wired into `lib/sessionTools.ts`. (Kimi Code was dropped on 2026-11-24: the owner's
Kimi plan does not include it.) Cost tiers (§2.4a) arrive with distribution in phase 3;
until then a task's tool is whatever the plan names.

---

## 5. Decisions needed before building

1. **Checkpoints.** Approve the plan only (proposed default), or also approve the
   delivery before anything is merged or sent?
2. **Commands.** May a run execute a project's allowlisted check commands, or should
   phase 2 stop at file edits plus a model's review?
3. **Where "edit" is allowed.** Two machines are answer-only or off today. A run can
   only place edit work on machines set to allow it.

---

## 6. Known limits of this design

- The master must be up. A run pauses while there is no master, and resumes.
- Off the LAN, each hop through OneDrive costs one to two minutes.
- Every task spends subscription quota on the machine that runs it; a large run can
  reach a plan's limit, which is why budgets pause rather than push.
- Codex and Hermes cannot fork a session, so two tasks must never share one of their
  sessions. Claude can.
- Hermes started from Mission Control has no terminal tools (see `HERMES_TOOLSETS`),
  so as a worker it can research, plan and edit files, but another tool must run
  anything.
