import { checkDueSchedules } from "./schedules";
import { checkWatchers } from "./watchers";
import { nudgeStaleApprovals } from "./attention";
import { maybeRescan } from "./youtubeWatch";
import { syncExecuting } from "./pipeline";
import { ensureScaffold } from "./vault";
import { readRegistry } from "./registry";
import { clusterTick } from "./cluster";
import { maybeRefreshProfile } from "./userProfile";
import { syncApprovedMissions } from "./approvals";
import { maybeRunHealth } from "./health";
import { maybeShare } from "./sessionShare";
import { bridgeTick } from "./bridge";
import { sessionJobsTick } from "./sessionActions";
import { startPeerServer } from "./peer";
import { alertsTick, drainSpool, maintainHooks } from "./sessionEvents";
import { publishLive } from "./fleetLive";
import { maybeDailySummary } from "./dailySummary";
import { sessionsSnapshot } from "./sessions";
import { mergeRemoteSessions } from "./sessionShare";

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
  // Health checks run on EVERY machine (a signed-out CLI on a backup node
  // matters the moment it becomes master). Throttled to every 10 min inside.
  setInterval(() => void maybeRunHealth().catch(() => {}), 60_000);
  // Session summaries, conversation digests and tool memory → the vault, for
  // the rest of the machine group (every machine; throttled to 5 min inside).
  setInterval(() => void maybeShare().catch(() => {}), 60_000);
  // Projects page: replies / new sessions / threads asked for by your other
  // machines (through the vault), and results of the ones this machine sent.
  setInterval(() => void sessionJobsTick().catch(() => {}), 15_000);
  setTimeout(() => void maybeRunHealth().catch(() => {}), 20_000);
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
    checkDueSchedules().catch(() => {});
    checkWatchers().catch(() => {});
    nudgeStaleApprovals().catch(() => {});
    maybeRescan().catch(() => {}); // throttled to every 4h internally
    syncExecuting().catch(() => {}); // advance pipeline items whose builds finished
    syncApprovedMissions().catch(() => {}); // launch approvals resolved on ANY machine
    bridgeTick().catch(() => {}); // vault bridge for Claude Duet / OpenAI Dots (inbox, outbox, Status.md)
    maybeRefreshProfile().catch(() => {}); // throttled to weekly internally
    void refreshScaffold(); // no-op unless the day rolled over
    void sessionsSnapshot()
      .then((snap) => mergeRemoteSessions(snap.sessions))
      .then((m) => alertsTick(m.sessions)) // Telegram pings for session alerts, when turned on
      .catch(() => {});
    maybeDailySummary().catch(() => {}); // yesterday's machines note, once after 6 AM
  }, 30_000);
  // catch anything already due shortly after boot
  setTimeout(async () => {
    const isMaster = await clusterTick().catch(() => true);
    if (!isMaster) return;
    checkDueSchedules().catch(() => {});
    checkWatchers().catch(() => {});
    void refreshScaffold();
  }, 5_000);
}
