import { checkDueSchedules } from "./schedules";
import { checkWatchers } from "./watchers";
import { nudgeStaleApprovals } from "./attention";
import { maybeRescan } from "./youtubeWatch";
import { syncExecuting } from "./pipeline";
import { ensureScaffold } from "./vault";
import { readRegistry } from "./registry";
import { clusterTick, readConfig } from "./cluster";
import os from "os";
import { maybeRefreshProfile } from "./userProfile";
import { syncApprovedMissions } from "./approvals";
import { maybeRunHealth } from "./health";
import { maybeShare } from "./sessionShare";
import { bridgeTick } from "./bridge";
import { sessionJobsTick } from "./sessionActions";
import { teamTick } from "./team";
import { githubDailyTick } from "./githubReport";
import { workTick } from "./repoTasks";
import { startPeerServer } from "./peer";
import { alertsTick, drainSpool, maintainHooks } from "./sessionEvents";
import { publishLive } from "./fleetLive";
import { maybeDailySummary } from "./dailySummary";
import { sessionsSnapshot } from "./sessions";
import { mergeRemoteSessions } from "./sessionShare";
import { maybeWeeklyRollup } from "./rollup";
import { runsTick } from "./runs";
import { markSchedulerInstance, recordRunningBuild } from "./selfUpdate";
import { MEM_FULL, MEM_WARN, memPressure, sampleLoad } from "./machineLoad";
import { runHealthChecks } from "./health";
import { isPaused } from "./fleetPause";
import { publishSetup } from "./machineSetup";
import { maybePublishLog } from "./remoteLog";

async function refreshScaffold(): Promise<void> {
  const reg = await readRegistry().catch(() => null);
  const agents = reg
    ? [...reg.llms.map((l) => ({ id: l.id, tagline: `${l.provider} · ${l.model}` })), ...reg.commandAgents.map((a) => ({ id: a.id, tagline: a.tagline }))]
    : [];
  await ensureScaffold(agents).catch(() => {});
}

/**
 * Background tick that fires due schedules. Started once per server process
 * from instrumentation.ts (both `next dev` and `next start`).
 */
let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;
  console.log("[mission-control] schedule tick armed (30s interval)");
  // Which build this process serves (Fleet → Versions), and: updates start from this instance only.
  recordRunningBuild();
  markSchedulerInstance();
  // Health checks run on EVERY machine (a signed-out CLI on a backup node
  // matters the moment it becomes master). Throttled to every 10 min inside.
  setInterval(() => void maybeRunHealth().catch(() => {}), 60_000);
  // Session summaries, conversation digests and tool memory → the vault, for
  // the rest of the machine group (every machine; throttled to 5 min inside).
  setInterval(() => void maybeShare().catch(() => {}), 60_000);
  // Each machine's AI-tool setup (MCP servers, skills, plugins, CLI versions) → the vault for
  // Fleet → Setup (every 15 minutes inside; names and versions only, never settings or keys).
  setInterval(() => void publishSetup().catch(() => {}), 60_000);
  // The remote-action log (what other machines asked of this one, and what it asked of them) →
  // the vault for Fleet → Remote actions (when it changed, at most every 10 minutes inside).
  setInterval(() => void readConfig().then((c) => maybePublishLog(c.label || os.hostname())).catch(() => {}), 60_000);
  // Projects page: replies / new sessions / threads asked for by your other
  // machines (through the vault), and results of the ones this machine sent.
  setInterval(() => void sessionJobsTick().catch(() => {}), 15_000);
  // Work: follow tasks handed to the fleet (and start the next one if "start automatically" is on)
  setInterval(() => void workTick().catch((e: Error) => console.error(`[mission-control] work: ${e.message}`)), 30_000);
  // GitHub dashboard: a fresh report once a day where the GitHub CLI is signed in (held by the fleet pause)
  setInterval(() => void (isPaused() ? Promise.resolve() : githubDailyTick()).catch(() => {}), 30 * 60_000);
  // Command -> Team: settle teammates' replies and send their hand-offs (only this instance does, rule 1)
  setInterval(() => void teamTick().catch((e: Error) => console.error(`[mission-control] team: ${e.message}`)), 15_000);
  // Project runs this machine drives: plan, hand tasks to sessions, review, deliver.
  // Every machine, not only the master - a run belongs to the machine that started it.
  setInterval(() => void runsTick().catch(() => {}), 20_000);
  setTimeout(() => void maybeRunHealth().catch(() => {}), 20_000);
  // CPU, memory, commit, GPU, biggest processes → data/load.json, carried by the heartbeat. When
  // memory crosses a line, Health runs at once (it warns before Windows runs out of commit).
  // The same for the fleet pause, set on any machine: Health shows it within a minute.
  let memLevel = "ok";
  let pausedSeen = isPaused();
  const loadTick = async () => {
    const p = memPressure(await sampleLoad().catch(() => null));
    const level = p === undefined ? memLevel : p >= MEM_FULL ? "fail" : p >= MEM_WARN ? "warn" : "ok";
    const paused = isPaused();
    if (level !== memLevel || paused !== pausedSeen) {
      memLevel = level;
      pausedSeen = paused;
      void runHealthChecks().catch(() => {});
    }
  };
  setTimeout(() => void loadTick(), 8_000);
  setInterval(() => void loadTick(), 60_000);
  // LAN link to the other machines (peer endpoints only, on :3101)
  startPeerServer();
  // Session alerts: events the hook spooled while the server was down, keep the
  // hook installed per the shared setting, live state → vault for Off-LAN machines
  setTimeout(() => void maintainHooks(true).catch(() => {}), 15_000);
  setInterval(() => {
    void drainSpool().catch(() => {});
    void maintainHooks().catch(() => {});
    void publishLive().catch(() => {});
  }, 60_000);
  // Master-only duties are gated on holding the cluster lease. With clustering
  // off (default) clusterTick() returns true, so a lone machine runs as always.
  setInterval(async () => {
    const isMaster = await clusterTick().catch(() => true);
    if (!isMaster) return;
    nudgeStaleApprovals().catch(() => {});
    // Fleet → Pause (lib/fleetPause.ts): nothing below starts AI work while the fleet is paused
    if (!isPaused()) {
      checkDueSchedules().catch(() => {});
      checkWatchers().catch(() => {});
      maybeRescan().catch(() => {}); // throttled to every 4h internally
      syncExecuting().catch(() => {}); // advance pipeline items whose builds finished
      syncApprovedMissions().catch(() => {}); // launch approvals resolved on ANY machine
      bridgeTick().catch(() => {}); // vault bridge for Claude Duet / OpenAI Dots (inbox, outbox, Status.md)
      maybeRefreshProfile().catch(() => {}); // throttled to weekly internally
    }
    void refreshScaffold(); // no-op unless the day rolled over
    void sessionsSnapshot()
      .then((snap) => mergeRemoteSessions(snap.sessions))
      .then((m) => alertsTick(m.sessions)) // Telegram pings for session alerts, when turned on
      .catch(() => {});
    maybeDailySummary().catch(() => {}); // yesterday's machines note, once after 6 AM
    maybeWeeklyRollup().catch(() => {}); // weekly notes + archive + conflict-copy sweep, every 6h
  }, 30_000);
  // catch anything already due shortly after boot
  setTimeout(async () => {
    const isMaster = await clusterTick().catch(() => true);
    if (!isMaster) return;
    if (!isPaused()) {
      checkDueSchedules().catch(() => {});
      checkWatchers().catch(() => {});
    }
    void refreshScaffold();
  }, 5_000);
}
