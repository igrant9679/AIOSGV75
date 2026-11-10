import { existsSync, readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { vaultInfo } from "./vault";

/**
 * Network-wide settings: one file in the shared vault,
 * "<vault>/Agentic OS/Cluster/settings.json", so every machine in a network
 * reads the same owner name, app name and Telegram bot without per-machine setup.
 * A second, unrelated network simply has its own vault, and so its own file.
 *
 * Precedence for each value: environment variable (.env.local) > this file > default.
 * The defaults reproduce the original network's behaviour when the file doesn't exist
 * at all (older installs never wrote one). A network created by the installer always
 * has the file, so it never inherits the original network's Telegram chat.
 */
export interface NetSettings {
  v: 1;
  /** e.g. "Home lab" - shown on the settings page and in Telegram headers */
  networkName: string;
  /** the person the agents work for, used in agent prompts */
  ownerName: string;
  /** header title, e.g. "AI OPERATIONS CONTROL" */
  appName: string;
  /** header subtitle, e.g. "LOCAL AI OPERATIONS DECK" */
  appTagline: string;
  /** the product's name in running text (Guide, messages, prompts), e.g. "Agentic Operations Control" */
  productName?: string;
  telegram: { botToken: string; chatId: string };
  updatedAt?: number;
  updatedBy?: string;
}

const LEGACY_CHAT_ID = "7284896916";
export const DEFAULT_APP_NAME = "AI OPERATIONS CONTROL";
export const DEFAULT_APP_TAGLINE = "LOCAL AI OPERATIONS DECK";
export const DEFAULT_PRODUCT_NAME = "Mission Control";

function file(): string {
  return path.join(vaultInfo().base, "Cluster", "settings.json");
}

function blank(): NetSettings {
  return { v: 1, networkName: "", ownerName: "", appName: "", appTagline: "", productName: "", telegram: { botToken: "", chatId: "" } };
}

function parse(raw: string): NetSettings {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // PowerShell 5.1 may write a BOM
  const j = JSON.parse(text) as Partial<NetSettings>;
  const b = blank();
  return {
    ...b,
    ...j,
    v: 1,
    telegram: { ...b.telegram, ...(j.telegram ?? {}) },
  };
}

let cache: { at: number; value: NetSettings | null } | null = null;
const TTL_MS = 30_000;

/** The stored file, or null when this network has none (older installs). Cached 30 s. */
export function readNetSettingsSync(): NetSettings | null {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value: NetSettings | null = null;
  try {
    const f = file();
    if (existsSync(f)) value = parse(readFileSync(f, "utf8"));
  } catch {
    value = cache?.value ?? null; // half-synced file: keep the last good copy
  }
  cache = { at: Date.now(), value };
  return value;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Values in effect on this machine (env > file > default). */
export function effectiveNetSettings() {
  const f = readNetSettingsSync();
  const hasFile = f !== null;
  const envToken = str(process.env.TELEGRAM_BOT_TOKEN);
  const envChat = str(process.env.TELEGRAM_TARGET);
  return {
    hasFile,
    networkName: str(f?.networkName),
    ownerName: str(f?.ownerName) || (hasFile ? "" : "Idris"),
    appName: str(f?.appName) || DEFAULT_APP_NAME,
    appTagline: str(f?.appTagline) || DEFAULT_APP_TAGLINE,
    productName: str(f?.productName) || DEFAULT_PRODUCT_NAME,
    botToken: envToken || str(f?.telegram.botToken),
    botTokenFrom: envToken ? ("this machine (.env.local)" as const) : str(f?.telegram.botToken) ? ("network settings" as const) : null,
    chatId: envChat || str(f?.telegram.chatId) || (hasFile ? "" : LEGACY_CHAT_ID),
    chatIdFrom: envChat ? ("this machine (.env.local)" as const) : str(f?.telegram.chatId) ? ("network settings" as const) : hasFile ? null : ("built-in default" as const),
  };
}

/** The product's name in running text ("Mission Control" unless the network renamed it). */
export function productName(): string {
  return effectiveNetSettings().productName;
}

/** Owner's name for agent prompts; "the user" when none is set. */
export function ownerName(): string {
  return effectiveNetSettings().ownerName || "the user";
}

function maskToken(t: string): string {
  if (!t) return "";
  const id = t.split(":")[0] ?? "";
  return `${id}:••••${t.slice(-4)}`;
}

/** Safe to send to the browser: the bot token is masked. */
export function publicNetSettings() {
  const e = effectiveNetSettings();
  const v = vaultInfo();
  return {
    hasFile: e.hasFile,
    file: file(),
    networkName: e.networkName,
    ownerName: e.ownerName,
    appName: e.appName,
    appTagline: e.appTagline,
    productName: e.productName,
    obsidianVault: path.basename(v.root.replace(/[\\/]+$/, "")),
    vaultRoot: v.root,
    vaultOk: existsSync(v.root),
    telegram: {
      tokenSet: Boolean(e.botToken),
      tokenMasked: maskToken(e.botToken),
      tokenFrom: e.botTokenFrom,
      chatId: e.chatId,
      chatIdFrom: e.chatIdFrom,
    },
  };
}

export type NetSettingsPatch = Partial<Omit<NetSettings, "v" | "telegram">> & { telegram?: Partial<NetSettings["telegram"]> };

/** Merge a change into the vault file (creating it). Empty strings clear a value. */
export async function writeNetSettings(patch: NetSettingsPatch, by: string): Promise<NetSettings> {
  const f = file();
  let cur = readNetSettingsSync();
  if (!cur) {
    // first save on a network that had no file: start from what's in effect, so
    // saving one field doesn't silently drop the defaults this network relied on
    const e = effectiveNetSettings();
    cur = {
      ...blank(),
      ownerName: e.ownerName,
      telegram: { botToken: e.botTokenFrom === "network settings" ? e.botToken : "", chatId: e.chatIdFrom === "built-in default" ? e.chatId : "" },
    };
  }
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : undefined);
  const next: NetSettings = {
    ...cur,
    ...(patch.networkName !== undefined ? { networkName: clip(patch.networkName, 80) ?? "" } : {}),
    ...(patch.ownerName !== undefined ? { ownerName: clip(patch.ownerName, 80) ?? "" } : {}),
    ...(patch.appName !== undefined ? { appName: clip(patch.appName, 60) ?? "" } : {}),
    ...(patch.appTagline !== undefined ? { appTagline: clip(patch.appTagline, 80) ?? "" } : {}),
    ...(patch.productName !== undefined ? { productName: clip(patch.productName, 60) ?? "" } : {}),
    telegram: {
      botToken: patch.telegram?.botToken !== undefined ? (clip(patch.telegram.botToken, 200) ?? "") : cur.telegram.botToken,
      chatId: patch.telegram?.chatId !== undefined ? (clip(patch.telegram.chatId, 40) ?? "") : cur.telegram.chatId,
    },
    v: 1,
    updatedAt: Date.now(),
    updatedBy: by,
  };
  await fs.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, f);
  cache = { at: Date.now(), value: next };
  return next;
}

/** Valid-looking bot token: "<digits>:<35ish url-safe chars>". */
export function looksLikeBotToken(t: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(t.trim());
}
