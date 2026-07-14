export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
    // Bring up companion daemons (Hermes dashboard, Ollama) this app depends on.
    // The app server itself auto-starts at login, so this also covers reboots.
    const { ensureDaemons } = await import("./lib/daemons");
    void ensureDaemons();
  }
}
