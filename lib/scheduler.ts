import { checkDueSchedules } from "./schedules";
import { ensureScaffold } from "./vault";
import { readRegistry } from "./registry";

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
  setInterval(() => {
    checkDueSchedules().catch(() => {});
    void refreshScaffold(); // no-op unless the day rolled over
  }, 30_000);
  // catch anything already due shortly after boot
  setTimeout(() => {
    checkDueSchedules().catch(() => {});
    void refreshScaffold();
  }, 5_000);
}
