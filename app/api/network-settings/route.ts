import { existsSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { publicNetSettings, writeNetSettings, effectiveNetSettings, looksLikeBotToken, type NetSettingsPatch } from "@/lib/netSettings";
import { inspectBot, sendTelegram } from "@/lib/telegram";
import { setEnvVar, restartSelf } from "@/lib/envFile";

export const dynamic = "force-dynamic";

/** This network's shared settings (stored in the vault) + this machine's vault folder. */
export async function GET() {
  return Response.json({ ...publicNetSettings(), host: os.hostname() });
}

type Body = {
  action?: string;
  networkName?: string;
  ownerName?: string;
  appName?: string;
  appTagline?: string;
  productName?: string;
  chatId?: string;
  botToken?: string;
  clearToken?: boolean;
  path?: string;
  create?: boolean;
};

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  let b: Body;
  try {
    b = (await req.json()) as Body;
  } catch {
    return bad("invalid JSON");
  }
  try {
    switch (b.action) {
      case "save": {
        if (!publicNetSettings().vaultOk) return bad("The vault folder isn't reachable on this machine, so network settings can't be saved. Fix the vault first.");
        const patch: NetSettingsPatch = {};
        for (const k of ["networkName", "ownerName", "appName", "appTagline", "productName"] as const) if (typeof b[k] === "string") patch[k] = b[k];
        const tg: NetSettingsPatch["telegram"] = {};
        if (typeof b.chatId === "string") {
          const c = b.chatId.trim();
          if (c && !/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,}$/.test(c)) return bad("Chat ID should be a number (e.g. 123456789, or -100... for a group) or a @channelname.");
          tg.chatId = c;
        }
        if (b.clearToken) tg.botToken = "";
        else if (typeof b.botToken === "string" && b.botToken.trim()) {
          if (!looksLikeBotToken(b.botToken)) return bad("That doesn't look like a bot token. It looks like 123456789:ABC... - copy it from @BotFather.");
          tg.botToken = b.botToken.trim();
        }
        if (Object.keys(tg).length) patch.telegram = tg;
        await writeNetSettings(patch, os.hostname());
        return Response.json({ ok: true, ...publicNetSettings(), host: os.hostname() });
      }
      case "findChats": {
        const token = (b.botToken?.trim() || effectiveNetSettings().botToken).trim();
        return Response.json(await inspectBot(token));
      }
      case "test": {
        const e = effectiveNetSettings();
        if (!e.chatId) return bad("Set the chat ID first.");
        const ok = await sendTelegram(`✅ Test message from ${e.appName}${e.networkName ? ` (${e.networkName})` : ""} on ${os.hostname()}. Telegram is set up.`);
        return ok ? Response.json({ ok: true }) : bad("Telegram didn't accept the message - check the bot token and that you've pressed Start in a chat with the bot.", 502);
      }
      case "vault": {
        const p = (b.path ?? "").trim().replace(/^"|"$/g, "").replace(/[\\/]+$/, "");
        if (!p || !path.isAbsolute(p)) return bad("Enter the full path of the vault folder, e.g. C:\\Users\\you\\OneDrive\\AI Vault");
        const base = path.join(p, "Agentic OS");
        if (!existsSync(base)) {
          if (!b.create) return bad(`"${p}" isn't a vault yet (no "Agentic OS" folder inside). Tick "Create a new vault here" to make it one.`);
          await fs.mkdir(path.join(base, "Cluster"), { recursive: true });
        }
        // a new vault = a new network: give it its own (empty) settings file right away, so it
        // never falls back to the original network's defaults (its Telegram chat, owner name)
        const settingsFile = path.join(base, "Cluster", "settings.json");
        if (b.create && !existsSync(settingsFile)) {
          const fresh = { v: 1, networkName: "", ownerName: "", appName: "", appTagline: "", productName: "", telegram: { botToken: "", chatId: "" }, updatedAt: Date.now(), updatedBy: os.hostname() };
          await fs.writeFile(settingsFile, JSON.stringify(fresh, null, 2), "utf8");
        }
        await setEnvVar("VAULT_DIR", p);
        return Response.json({ ok: true, path: p, created: Boolean(b.create), restartNeeded: true });
      }
      case "restart": {
        const ok = await restartSelf();
        return ok ? Response.json({ ok: true }) : bad("No watchdog to restart the app - restart it yourself (stop.cmd, then server.cmd).", 409);
      }
      default:
        return bad("unknown action");
    }
  } catch (e) {
    return bad((e as Error).message, 500);
  }
}
