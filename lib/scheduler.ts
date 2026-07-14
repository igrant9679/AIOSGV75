import { checkDueSchedules } from "./schedules";
import { checkWatchers } from "./watchers";
import { nudgeStaleApprovals } from "./attention";
import { maybeRescan } from "./youtubeWatch";
import { syncExecuting } from "./pipeline";
import { ensureScaffold } from "./vault";
import { readRegistry } from "./registry";
import { clusterTick } from "./cluster";

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
    void refreshScaffold(); // no-op unless the day rolled over
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
