import { spawn } from "child_process";

/** Send a Telegram message to the owner via OpenClaw's bot bridge. */
const TELEGRAM_TARGET = process.env.TELEGRAM_TARGET ?? "7284896916";

export function sendTelegram(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "openclaw",
      ["message", "send", "--channel", "telegram", "--target", TELEGRAM_TARGET, "--message", JSON.stringify(text)],
      { shell: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}
