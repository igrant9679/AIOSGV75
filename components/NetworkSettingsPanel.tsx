"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck } from "./icons";
import { useMission } from "./store";
import { refreshNetSettings, useNetSettings, NET_DEFAULTS } from "./useNetSettings";

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";
const btnCls = "h-9 cursor-pointer rounded-lg border border-line px-3 text-xs text-ink-dim hover:bg-white/[0.06] disabled:opacity-40";
const saveCls =
  "flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-cyan-600 to-neon-cyan px-4 text-xs font-semibold text-white disabled:opacity-40";

type Chat = { id: string; title: string; type: string };

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/network-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!res.ok || j.error) throw new Error(j.error ?? `failed (${res.status})`);
  return j;
}

/**
 * Settings shared by every machine in this network, kept in the vault
 * (Agentic OS/Cluster/settings.json): names, Telegram bot, and this machine's vault folder.
 */
export default function NetworkSettingsPanel() {
  const { addEvent } = useMission();
  const net = useNetSettings();
  const loaded = useRef(false);

  const [networkName, setNetworkName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [appName, setAppName] = useState("");
  const [appTagline, setAppTagline] = useState("");
  const [productName, setProductName] = useState("");
  const [chatId, setChatId] = useState("");
  const [token, setToken] = useState("");
  const [vaultPath, setVaultPath] = useState("");
  const [createVault, setCreateVault] = useState(false);

  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [chats, setChats] = useState<{ bot: string; list: Chat[] } | null>(null);
  const [restartOffered, setRestartOffered] = useState(false);

  useEffect(() => {
    if (!net || loaded.current) return;
    loaded.current = true;
    setNetworkName(net.networkName);
    setOwnerName(net.ownerName);
    setAppName(net.appName === NET_DEFAULTS.appName ? "" : net.appName);
    setAppTagline(net.appTagline === NET_DEFAULTS.appTagline ? "" : net.appTagline);
    setProductName(net.productName === NET_DEFAULTS.productName ? "" : net.productName);
    setChatId(net.telegram.chatId);
    setVaultPath(net.vaultRoot);
  }, [net]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const saveNames = () =>
    run("names", async () => {
      await post({ action: "save", networkName, ownerName, appName, appTagline, productName });
      await refreshNetSettings();
      setMsg({ kind: "ok", text: "Saved for every machine in this network (they pick it up within a minute of the vault syncing)." });
      addEvent("SETTINGS", "Network settings saved", "cyan");
    });

  const saveTelegram = () =>
    run("telegram", async () => {
      await post({ action: "save", chatId, ...(token.trim() ? { botToken: token.trim() } : {}) });
      setToken("");
      await refreshNetSettings();
      setMsg({ kind: "ok", text: "Telegram settings saved for this network. Send a test message to check." });
      addEvent("SETTINGS", "Telegram settings saved", "cyan");
    });

  const findChats = () =>
    run("find", async () => {
      const j = (await post({ action: "findChats", ...(token.trim() ? { botToken: token.trim() } : {}) })) as { ok: boolean; bot?: string; chats?: Chat[]; error?: string };
      if (!j.ok) throw new Error(j.error ?? "couldn't reach the bot");
      setChats({ bot: j.bot ?? "bot", list: j.chats ?? [] });
      if (j.chats?.length === 1) setChatId(j.chats[0].id);
    });

  const test = () =>
    run("test", async () => {
      await post({ action: "test" });
      setMsg({ kind: "ok", text: "Test message sent - check Telegram." });
    });

  const saveVault = () =>
    run("vault", async () => {
      const j = (await post({ action: "vault", path: vaultPath, create: createVault })) as { created?: boolean };
      setRestartOffered(true);
      setMsg({ kind: "ok", text: `${j.created ? "New vault created and set" : "Vault folder set"} for this machine. Restart ${net?.productName || NET_DEFAULTS.productName} to switch to it.` });
    });

  const restart = () =>
    run("restart", async () => {
      await post({ action: "restart" });
      setMsg({ kind: "ok", text: "Restarting... this page reconnects in about 30 seconds (reload it if it doesn't)." });
    });

  const tg = net?.telegram;
  const tgReady = Boolean(tg?.chatId && tg?.tokenSet);

  return (
    <Panel
      title="This network"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <StatusOrb accent={!net ? "cyan" : net.vaultOk ? "lime" : "rose"} pulsing={false} size={7} />
          {net ? `${net.networkName || "unnamed network"} · ${net.host}` : "loading…"}
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <p className="text-xs leading-6 text-ink-faint">
          Settings shared by <span className="text-ink">every machine in this network</span>. They live in the vault (
          <span className="font-mono">Agentic OS/Cluster/settings.json</span>), so set them once here and the other machines pick
          them up through OneDrive. A second network with its own vault keeps its own settings.
        </p>

        {msg && (
          <div
            role={msg.kind === "err" ? "alert" : "status"}
            className={`rounded-lg border px-3 py-2 font-mono text-xs ${msg.kind === "err" ? "border-neon-rose/30 bg-neon-rose/10 text-neon-rose" : "border-neon-lime/30 bg-neon-lime/10 text-neon-lime"}`}
          >
            {msg.text}
          </div>
        )}

        {/* names */}
        <div className="rounded-xl border border-line bg-white/[0.02] p-4">
          <p className="mb-3 text-sm font-semibold text-ink">Names</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ns-net">NETWORK NAME</label>
              <input id="ns-net" value={networkName} onChange={(e) => setNetworkName(e.target.value)} placeholder="e.g. Office LAN" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ns-owner">YOUR NAME <span className="normal-case">(agents work for this person)</span></label>
              <input id="ns-owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Sam" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ns-app">APP NAME <span className="normal-case">(header)</span></label>
              <input id="ns-app" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder={NET_DEFAULTS.appName} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ns-tag">SUBTITLE</label>
              <input id="ns-tag" value={appTagline} onChange={(e) => setAppTagline(e.target.value)} placeholder={NET_DEFAULTS.appTagline} className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls} htmlFor="ns-product">NAME IN TEXT <span className="normal-case">(Guide, messages, agent prompts)</span></label>
              <input id="ns-product" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder={NET_DEFAULTS.productName} className={inputCls} />
            </div>
          </div>
          <div className="mt-3">
            <motion.button whileTap={{ scale: 0.96 }} onClick={saveNames} disabled={!!busy || !net?.vaultOk} className={saveCls}>
              <IconCheck width={14} height={14} /> {busy === "names" ? "Saving…" : "Save names"}
            </motion.button>
          </div>
        </div>

        {/* telegram */}
        <div className="rounded-xl border border-line bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2">
            <StatusOrb accent={tgReady ? "lime" : "amber"} pulsing={false} size={7} />
            <p className="text-sm font-semibold text-ink">Telegram</p>
            <span className="font-mono text-[10px] text-ink-faint">{tgReady ? "ready" : "not set up yet"}</span>
          </div>
          <ol className="mb-3 list-decimal space-y-0.5 pl-5 text-[11px] leading-5 text-ink-faint">
            <li>In Telegram, open <span className="font-mono text-ink">@BotFather</span>, send <span className="font-mono text-ink">/newbot</span> and follow the steps. It replies with a bot token.</li>
            <li>Paste the token below, then open your new bot in Telegram and press <span className="text-ink">Start</span> (or send it any message).</li>
            <li>Click <span className="text-ink">Find my chat</span>, pick your chat, then <span className="text-ink">Save</span> and <span className="text-ink">Send test</span>.</li>
          </ol>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ns-token">BOT TOKEN</label>
              <input
                id="ns-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={tg?.tokenSet ? `${tg.tokenMasked} (set - paste a new one to replace)` : "123456789:ABC..."}
                className={inputCls}
              />
              {tg?.tokenFrom && <p className="mt-1 text-[10px] text-ink-faint">In use: from {tg.tokenFrom}</p>}
            </div>
            <div>
              <label className={labelCls} htmlFor="ns-chat">CHAT ID</label>
              <input id="ns-chat" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="e.g. 123456789" className={inputCls} />
              {tg?.chatIdFrom && <p className="mt-1 text-[10px] text-ink-faint">In use: from {tg.chatIdFrom}</p>}
            </div>
          </div>
          {chats && (
            <div className="mt-3 rounded-lg border border-line p-2">
              <p className="mb-1 font-mono text-[10px] text-ink-faint">{chats.bot} - recent chats {chats.list.length ? "(click to use)" : ""}</p>
              {chats.list.length === 0 ? (
                <p className="text-[11px] text-ink-faint">No messages yet. Open the bot in Telegram, press Start or send it &quot;hi&quot;, then click Find my chat again.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {chats.list.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setChatId(c.id)}
                      className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] ${chatId === c.id ? "border-neon-lime/50 text-neon-lime" : "border-line text-ink-dim hover:bg-white/[0.06]"}`}
                    >
                      {c.title} <span className="font-mono text-[10px] text-ink-faint">{c.id} · {c.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={findChats} disabled={!!busy || (!token.trim() && !tg?.tokenSet)} className={btnCls}>
              {busy === "find" ? "Asking Telegram…" : "Find my chat"}
            </button>
            <motion.button whileTap={{ scale: 0.96 }} onClick={saveTelegram} disabled={!!busy || !net?.vaultOk} className={saveCls}>
              <IconCheck width={14} height={14} /> {busy === "telegram" ? "Saving…" : "Save"}
            </motion.button>
            <button onClick={test} disabled={!!busy || !tg?.chatId} className={btnCls}>
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-ink-faint">
            The token is stored in the vault so any machine that takes over as master can send. Replies from your phone (approvals,
            chatting with agents) also need OpenClaw on the primary machine, set up with this same bot.
          </p>
        </div>

        {/* vault */}
        <div className="rounded-xl border border-line bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center gap-2">
            <StatusOrb accent={net?.vaultOk ? "lime" : "rose"} pulsing={false} size={7} />
            <p className="text-sm font-semibold text-ink">Vault on this machine</p>
            <span className="font-mono text-[10px] text-ink-faint">{net ? (net.vaultOk ? `Obsidian vault "${net.obsidianVault}"` : "folder not found") : ""}</span>
          </div>
          <p className="mb-3 text-[11px] leading-5 text-ink-faint">
            The OneDrive folder this machine uses as its vault (it contains <span className="font-mono">Agentic OS</span>). Every
            machine in a network points at the same synced folder. To start a new network, point this at an empty OneDrive folder and
            tick &quot;Create a new vault here&quot;.
          </p>
          <label className={labelCls} htmlFor="ns-vault">VAULT FOLDER</label>
          <input id="ns-vault" value={vaultPath} onChange={(e) => setVaultPath(e.target.value)} placeholder={String.raw`C:\Users\you\OneDrive\AI Vault`} className={inputCls} />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
            <input type="checkbox" checked={createVault} onChange={(e) => setCreateVault(e.target.checked)} className="cursor-pointer accent-current" />
            Create a new vault here (makes the folder and its &quot;Agentic OS&quot; inside)
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={saveVault} disabled={!!busy || !vaultPath.trim() || (vaultPath.trim() === net?.vaultRoot && !createVault)} className={btnCls}>
              {busy === "vault" ? "Checking…" : "Use this folder"}
            </button>
            {restartOffered && (
              <motion.button whileTap={{ scale: 0.96 }} onClick={restart} disabled={!!busy} className={saveCls}>
                {busy === "restart" ? "Restarting…" : "Restart now"}
              </motion.button>
            )}
          </div>
          {net && <p className="mt-2 break-all font-mono text-[10px] text-ink-faint">Network settings file: {net.file}{net.hasFile ? "" : " (not created yet - saved on first Save)"}</p>}
        </div>

        <p className="text-[11px] leading-5 text-ink-faint">
          This machine&apos;s own name and role are under <span className="text-ink">Machine Group &amp; Roles</span> below; LAN vs Off-LAN
          is on <span className="text-ink">Fleet → Network</span>.
        </p>
      </div>
    </Panel>
  );
}
