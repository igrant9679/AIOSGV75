import { spawn } from "child_process";
import { effectiveNetSettings } from "./netSettings";

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
/** The chat messages go to: TELEGRAM_TARGET in .env.local, else the network settings in the vault. */
function target(): string {
  return effectiveNetSettings().chatId;
}

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
        body: JSON.stringify({ chat_id: target(), text: part, disable_web_page_preview: true }),
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
      ["message", "send", "--channel", "telegram", "--target", target(), "--message", JSON.stringify(text)],
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
  const { botToken, chatId } = effectiveNetSettings();
  if (!chatId) {
    console.error("[telegram] no chat ID set - Settings -> This network -> Telegram");
    return Promise.resolve(false);
  }
  return botToken ? sendViaBotApi(botToken, text) : sendViaOpenClaw(text);
}

/** How this machine would send right now (for Health and the settings page). */
export function telegramTransport(): "bot" | "openclaw-or-none" {
  return effectiveNetSettings().botToken ? "bot" : "openclaw-or-none";
}

export interface BotChat {
  id: string;
  title: string;
  type: string;
}

/**
 * Who the bot is and which chats have messaged it lately - so the settings page can
 * fill in the chat ID after "send your bot any message". Uses getUpdates, which fails
 * with 409 while a gateway (OpenClaw) is long-polling the same bot.
 */
export async function inspectBot(token: string): Promise<{ ok: true; bot: string; chats: BotChat[] } | { ok: false; error: string }> {
  const t = token.trim();
  if (!t) return { ok: false, error: "No bot token set." };
  const call = async (method: string) => {
    const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, { signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string };
    return { status: res.status, ...j };
  };
  try {
    const me = await call("getMe");
    if (!me.ok) {
      return { ok: false, error: me.status === 401 || me.status === 404 ? "Telegram rejected the bot token - copy it again from @BotFather." : (me.description ?? `Telegram error ${me.status}`) };
    }
    const bot = (me.result as { username?: string; first_name?: string }) ?? {};
    const up = await call("getUpdates");
    if (!up.ok) {
      if (up.status === 409) {
        return { ok: false, error: `@${bot.username}: another program (likely OpenClaw's gateway) is reading this bot's messages, so chats can't be listed here. Get the chat ID from OpenClaw, or stop its gateway for a minute and try again.` };
      }
      return { ok: false, error: up.description ?? `Telegram error ${up.status}` };
    }
    type Chat = { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
    type Upd = { message?: { chat?: Chat }; my_chat_member?: { chat?: Chat } };
    const seen = new Map<string, BotChat>();
    for (const u of (up.result as Upd[]) ?? []) {
      const c = u.message?.chat ?? u.my_chat_member?.chat;
      if (!c) continue;
      const title = c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.username ? `@${c.username}` : String(c.id));
      seen.set(String(c.id), { id: String(c.id), title, type: c.type });
    }
    return { ok: true, bot: bot.username ? `@${bot.username}` : (bot.first_name ?? "bot"), chats: [...seen.values()].reverse() };
  } catch (e) {
    const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
    const why = cause?.code || cause?.message || (e as Error).message;
    return { ok: false, error: `Couldn't reach Telegram (${why}). Check this machine's internet connection.` };
  }
}
