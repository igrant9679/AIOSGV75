import { spawn } from "child_process";

/**
 * Telegram delivery to the owner. Two transports, in preference order:
 *
 *  1. `TELEGRAM_BOT_TOKEN` set → POST straight to the Bot API. Works on ANY
 *     machine, which is the point: schedules/watchers/nudges run only on the
 *     cluster MASTER (see the `if (!isMaster) return` gates in scheduler.ts),
 *     so whichever node holds the lease is the one that needs to send. When the
 *     master moved to a laptop without OpenClaw installed, every scheduled
 *     notification silently vanished — the spawn failed, `false` was returned,
 *     and the run still looked successful.
 *  2. no token → spawn `openclaw` as before. Keeps existing installs working
 *     with no config change.
 *
 * Sending over HTTP does NOT conflict with OpenClaw's gateway: that conflict is
 * on `getUpdates` (long-polling), which only one consumer may hold. Receiving —
 * i.e. answering approvals from the phone — still requires the gateway.
 */
const TELEGRAM_TARGET = process.env.TELEGRAM_TARGET ?? "7284896916";

/** Bot API rejects a sendMessage payload over 4096 chars. Mission reports run long. */
const MAX_TELEGRAM_CHARS = 4096;

function chunk(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
}

async function sendViaBotApi(token: string, text: string): Promise<boolean> {
  // Long reports are split rather than truncated so nothing is silently lost.
  for (const part of chunk(text, MAX_TELEGRAM_CHARS)) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No parse_mode: report bodies contain arbitrary Markdown-ish text and a
        // stray `*` or `_` would make Telegram 400 the whole message.
        body: JSON.stringify({ chat_id: TELEGRAM_TARGET, text: part, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        console.error(`[telegram] Bot API ${res.status}: ${detail}`);
        return false;
      }
    } catch (err) {
      console.error(`[telegram] Bot API request failed: ${(err as Error).message}`);
      return false;
    }
  }
  return true;
}

function sendViaOpenClaw(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      "openclaw",
      ["message", "send", "--channel", "telegram", "--target", TELEGRAM_TARGET, "--message", JSON.stringify(text)],
      { shell: true },
    );
    const timer = setTimeout(() => {
      child.kill();
      console.error("[telegram] openclaw send timed out after 120s");
      resolve(false);
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      // Failures used to be entirely silent — the #1 reason a missing message
      // was impossible to diagnose. Say something before returning false.
      if (code !== 0) console.error(`[telegram] openclaw send exited ${code} (is OpenClaw installed on this machine?)`);
      resolve(code === 0);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      console.error(`[telegram] could not spawn openclaw: ${err.message} — set TELEGRAM_BOT_TOKEN to send without it`);
      resolve(false);
    });
  });
}

export function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token ? sendViaBotApi(token, text) : sendViaOpenClaw(text);
}
