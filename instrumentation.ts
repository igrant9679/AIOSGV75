export async function register() {
  // MC_NO_BACKGROUND=1 → a UI-only preview server (e.g. `next dev -p 3100`
  // beside the boot server). Without it, a second server would fire every
  // schedule and Telegram nudge twice.
  if (process.env.MC_NO_BACKGROUND === "1") {
    console.log("[mission-control] MC_NO_BACKGROUND=1 — scheduler and daemons NOT started (preview mode)");
    return;
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // data\server-events.log: start, exit, signals, uncaught errors, memory - why it stopped
    const { startServerLog } = await import("./lib/serverLog");
    startServerLog();
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    // Bring up companion daemons (Hermes dashboard, Ollama) this app depends on.
    // The app server itself auto-starts at login, so this also covers reboots.
    const { ensureDaemons } = await import("./lib/daemons");
    void ensureDaemons();
  }
}
