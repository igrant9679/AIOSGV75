"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useProductName } from "../useNetSettings";
import Panel from "../ui/Panel";
import StatusOrb from "../ui/StatusOrb";
import Markdown from "../Markdown";
import { ACCENTS } from "@/lib/accents";
import type { AlertSettings, EventsView } from "@/lib/sessionEvents";
import type { HookStatus } from "@/lib/hooks";
import { SmallButton } from "./SessionPanel";

/**
 * Fleet page:
 *   NetworkPanel  per machine: LAN (direct, falls back to OneDrive) / Off-LAN
 *                 (OneDrive only) / Auto, an optional fixed address, and
 *                 whether it answers over the LAN right now
 *   AlertsPanel   session alerts: the hook on every machine, what counts as a
 *                 long run, Telegram, browser notifications, daily summary
 */

interface NetView {
  self: { host: string; label: string; addrs: string[]; nets?: string[]; port: number; listening: boolean };
  clusterOn: boolean;
  pingGiveUpMs?: number;
  machines: {
    host: string;
    label: string;
    online: boolean;
    mode: "lan" | "offlan" | "auto";
    address: string;
    lanAddrs: string[];
    /** whether its address is on one of this machine's networks */
    network?: "same" | "other" | "unknown";
    /** its last heartbeat (arrives through OneDrive) */
    lastSeen?: number;
    /** the latest OneDrive round-trip test */
    ping?: { id: string; sentAt: number; answeredAt?: number; answer?: string } | null;
    probe: { ok: boolean; ms?: number; address?: string; error?: string } | null;
  }[];
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};
const span = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

/** A direct-link error in plain words ("The operation was aborted due to timeout" means no answer in 2 s). */
const plainLanError = (e: string) => (/abort|timeout/i.test(e) ? "no answer within 2 seconds" : /ECONNREFUSED/i.test(e) ? "refused - is the app running there?" : e);

const MODES: [NetView["machines"][number]["mode"], string, string][] = [
  ["lan", "LAN", "On the same local network: talk directly (instant), and fall back to OneDrive if it can't be reached."],
  ["offlan", "Off-LAN", "Away from the main network: OneDrive only (1-2 minutes)."],
  ["auto", "Auto", "Try the LAN when an address is known, else OneDrive (same as LAN)."],
];

/**
 * The OneDrive side of a machine: when its heartbeat last arrived (that machine → here),
 * and a round-trip test (here → there → here) on request.
 */
function OneDriveLine({ m, giveUpMs, busy, onTest }: { m: NetView["machines"][number]; giveUpMs: number; busy: boolean; onTest: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const pg = m.ping;
  let test: ReactNode = null;
  if (pg?.answeredAt) {
    const ok = !/arrived too late/i.test(pg.answer ?? "");
    test = (
      <span style={{ color: ok ? ACCENTS.lime.base : ACCENTS.amber.base }} title={`Its answer: ${pg.answer ?? ""}`}>
        {ok ? "✓" : "!"} round trip through OneDrive in {span(pg.answeredAt - pg.sentAt)} ({ago(now - pg.answeredAt)} ago)
        {pg.answer && /unknown request/i.test(pg.answer)
          ? " · it runs an older version (update it to get the full answer)"
          : pg.answer && !/^pong/i.test(pg.answer)
            ? ` · it answered "${pg.answer.slice(0, 60)}"`
            : ""}
      </span>
    );
  } else if (pg && now - pg.sentAt < giveUpMs) {
    test = <span style={{ color: ACCENTS.violet.base }}>test sent {ago(now - pg.sentAt)} ago · waiting for its answer to sync back (usually 1-4 min)…</span>;
  } else if (pg) {
    test = (
      <span style={{ color: ACCENTS.amber.base }} title="The test request is in its folder in the vault; if that machine is on, OneDrive or the app there is not picking it up.">
        no answer after {ago(now - pg.sentAt)} - OneDrive may not be syncing on one of the two machines
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-faint">
      <span title="Each machine writes a heartbeat file to the vault every 30 s; this is when the latest one from that machine arrived here through OneDrive.">
        OneDrive: {m.lastSeen ? `last heard from it ${ago(now - m.lastSeen)} ago` : "no heartbeat yet"}
      </span>
      {test && <span>·</span>}
      {test}
      <button
        type="button"
        disabled={busy}
        onClick={onTest}
        title="Leaves a small test request for that machine in OneDrive and waits for its answer to come back. Proves both directions work. Nothing is run there."
        className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50"
      >
        Test OneDrive
      </button>
    </div>
  );
}

export function NetworkPanel() {
  const product = useProductName(); // this network's product name
  const [view, setView] = useState<NetView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addr, setAddr] = useState<Record<string, string>>({});

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch(init ? "/api/hub/network" : "/api/hub/network?probe=1", init);
      const b = (await r.json()) as NetView & { error?: string };
      if (r.ok) {
        setView(b);
        setError(null);
        setAddr(Object.fromEntries(b.machines.map((m) => [m.host, m.address])));
      } else setError(b.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // While a OneDrive test is out, look for its answer every 10 s. Only the ping fields are taken from
  // these light reads, so the LAN results of the last full check stay on screen.
  const waiting = view?.machines.some((m) => m.ping && !m.ping.answeredAt && Date.now() - m.ping.sentAt < (view.pingGiveUpMs ?? 900_000)) ?? false;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const b = (await (await fetch("/api/hub/network")).json()) as NetView;
        if (!b?.machines) return;
        setView((v) => (v ? { ...v, machines: v.machines.map((m) => { const n = b.machines.find((x) => x.host === m.host); return n ? { ...m, ping: n.ping, lastSeen: n.lastSeen, online: n.online } : m; }) } : v));
      } catch {
        /* next time */
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [waiting]);

  const ping = async (host: string) => {
    setBusy(host);
    try {
      const r = await fetch("/api/hub/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host, action: "ping" }) });
      const b = (await r.json()) as NetView & { error?: string };
      if (!r.ok) setError(b.error ?? `HTTP ${r.status}`);
      else setView((v) => (v ? { ...v, machines: v.machines.map((m) => { const n = b.machines.find((x) => x.host === m.host); return n ? { ...m, ping: n.ping } : m; }) } : v));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };

  const set = async (host: string, body: object) => {
    setBusy(host);
    await load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host, ...body }) });
    setBusy(null);
  };

  return (
    <Panel
      title="Network · LAN and Off-LAN machines"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          {view && (
            <span title="This machine's LAN listener (machine-to-machine requests only; the app stays on 127.0.0.1:3000)">
              {view.self.label}: {view.self.addrs.join(", ") || "no LAN address"} :{view.self.port} · {view.self.listening ? "listening" : "not listening"}
            </span>
          )}
          <SmallButton onClick={() => load()}>Check now</SmallButton>
        </span>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        <p className="text-[11px] leading-4 text-ink-dim">
          Machines on the same local network talk to each other directly, so replies, live status, threads and alerts arrive in seconds. Off-LAN machines go
          through OneDrive (1-2 minutes). Everything that works over the LAN also still works through OneDrive. This setting is shared by all your machines.
        </p>
        {error && <p className="text-[11px] text-ink-faint">{error}</p>}
        {view && !view.self.listening && (
          <p className="text-[11px]" style={{ color: ACCENTS.amber.base }}>
            This machine&apos;s LAN listener isn&apos;t running (port {view.self.port} may be in use). It starts with {product}; see Health for details.
          </p>
        )}
        {view && view.machines.length === 0 && <p className="text-[11px] text-ink-faint">No other machines in the group yet.</p>}
        {view?.machines.map((m) => {
          const p = m.probe;
          // A machine on another network is not a fault: it is online and reached through OneDrive.
          // Amber is kept for the cases worth a look - offline, or on this network and not answering.
          const elsewhere = !p?.ok && m.online && m.network === "other";
          const accent = !m.online ? "amber" : m.mode === "offlan" || elsewhere ? "violet" : p?.ok ? "lime" : "amber";
          const tone = ACCENTS[accent];
          const theirs = (m.address ? [m.address] : m.lanAddrs).join(", ");
          return (
            <div key={m.host} className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusOrb accent={accent} size={7} />
                <span className="text-xs font-semibold text-ink">{m.label}</span>
                <span
                  className="font-mono text-[10px]"
                  style={{ color: tone.base }}
                  title={
                    elsewhere
                      ? `${m.label} reports ${theirs}, which is not on this PC's network (${view.self.nets?.join(", ") || view.self.addrs.join(", ")}). It is probably connected to a different router, a guest network or another building. Everything still works through OneDrive, just slower (1-2 minutes). To make it direct, connect it to the same network as this PC.`
                      : undefined
                  }
                >
                  {!m.online
                    ? "offline · no heartbeat lately"
                    : m.mode === "offlan"
                      ? "online · Off-LAN · OneDrive only"
                      : p?.ok
                        ? `LAN ✓ ${p.address ?? ""} · ${p.ms} ms`
                        : elsewhere
                          ? `online · other network (${theirs}) → via OneDrive`
                          : p
                            ? `online · LAN not answering → via OneDrive${p.error ? ` (${plainLanError(p.error)})` : ""}`
                            : "online"}
                </span>
                <span className="flex-1" />
                {MODES.map(([v, label, hint]) => (
                  <button
                    key={v}
                    type="button"
                    disabled={busy === m.host}
                    title={hint}
                    aria-pressed={m.mode === v}
                    onClick={() => set(m.host, { mode: v })}
                    className="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                    style={m.mode === v ? { borderColor: "var(--page-accent)", color: "var(--page-accent)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {m.mode !== "offlan" && (
                <form
                  className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-faint"
                  onSubmit={(e) => {
                    e.preventDefault();
                    set(m.host, { address: addr[m.host] ?? "" });
                  }}
                >
                  <span>Addresses it reports: {m.lanAddrs.join(", ") || `none yet (update ${product} there)`}</span>
                  <span>· fixed address:</span>
                  <input
                    value={addr[m.host] ?? ""}
                    onChange={(e) => setAddr((a) => ({ ...a, [m.host]: e.target.value }))}
                    placeholder="optional, e.g. 192.168.4.30"
                    aria-label={`Fixed LAN address for ${m.label}`}
                    className="w-44 rounded-md border border-line bg-transparent px-1.5 py-0.5 text-[10px] text-ink outline-none"
                  />
                  <button type="submit" className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06]">
                    Save
                  </button>
                </form>
              )}
              <OneDriveLine m={m} giveUpMs={view.pingGiveUpMs ?? 900_000} busy={busy === m.host} onTest={() => ping(m.host)} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── session alerts ───

const BROWSER_KEY = "mc-browser-alerts";

export function browserAlertsOn(): boolean {
  try {
    return localStorage.getItem(BROWSER_KEY) === "on";
  } catch {
    return false;
  }
}

function Toggle({ on, label, hint, onClick, disabled }: { on: boolean; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-50"
      style={{ borderColor: on ? ACCENTS.lime.border : "var(--color-line)" }}
    >
      <span className="pt-0.5">
        <StatusOrb accent={on ? "lime" : "cyan"} size={7} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ink">
          {label} <span className="font-mono text-[10px] font-normal text-ink-faint">{on ? "on" : "off"}</span>
        </span>
        <span className="block text-[10px] leading-4 text-ink-faint">{hint}</span>
      </span>
    </button>
  );
}

const HOOK_TEXT: Record<string, string> = {
  installed: "installed",
  missing: "not installed",
  outdated: "needs a refresh",
  "other-notify": "Codex already has its own notify program (the Codex app's) - left alone, so Codex turns don't alert here",
  "no-claude": "Claude Code isn't on this machine",
  "no-codex": "Codex isn't on this machine",
};

export function AlertsPanel() {
  const product = useProductName(); // this network's product name
  const [data, setData] = useState<{ settings: AlertSettings; hooks: HookStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => setBrowser(browserAlertsOn()), []);

  const load = useCallback(async (body?: object) => {
    try {
      const r = await fetch("/api/hub/alerts", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
      const b = (await r.json()) as { settings: AlertSettings; hooks: HookStatus; error?: string };
      if (r.ok) {
        setData(b);
        setError(null);
      } else setError(b.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const post = async (body: object) => {
    setBusy(true);
    await load(body);
    setBusy(false);
  };

  const toggleBrowser = async () => {
    if (browser) {
      localStorage.setItem(BROWSER_KEY, "off");
      setBrowser(false);
      return;
    }
    if (typeof Notification === "undefined") {
      setError("This browser doesn't support notifications.");
      return;
    }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") {
      setError("The browser didn't allow notifications - allow them for this site in its settings.");
      return;
    }
    localStorage.setItem(BROWSER_KEY, "on");
    setBrowser(true);
  };

  const s = data?.settings;
  return (
    <Panel title="Session alerts">
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-4 text-ink-dim">
            A tiny hook in Claude Code (and Codex) tells {product} when a session needs you, finishes a turn, or closes - on every machine. Waiting sessions and
            long runs show under Command → Needs you.
          </p>
          {error && <p className="text-[11px] text-ink-faint">{error}</p>}
          {s && (
            <>
              <Toggle
                on={s.hooks}
                label="Install the hook on every machine"
                hint={`Adds ${product}'s hook to Claude Code's settings (~/.claude/settings.json) and Codex's notify (if free) on each machine, keeping your own hooks. Off removes it everywhere.`}
                onClick={() => post({ action: "settings", hooks: !s.hooks })}
                disabled={busy}
              />
              <p className="font-mono text-[10px] leading-4 text-ink-faint">
                This machine: Claude Code {HOOK_TEXT[data!.hooks.claude]} · Codex {HOOK_TEXT[data!.hooks.codex]}
                {s.hooks && (data!.hooks.claude === "missing" || data!.hooks.claude === "outdated") && (
                  <>
                    {" "}
                    <button type="button" onClick={() => post({ action: "install" })} className="cursor-pointer underline">
                      install now
                    </button>
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-[11px] text-ink-dim">
                <span>A turn counts as a long run after</span>
                <select
                  value={s.longMinutes}
                  onChange={(e) => post({ action: "settings", longMinutes: Number(e.target.value) })}
                  aria-label="Long run threshold"
                  className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink"
                >
                  {[2, 5, 10, 15, 30, 60].map((n) => (
                    <option key={n} value={n} style={{ background: "var(--color-panel)" }}>
                      {n}
                    </option>
                  ))}
                </select>
                <span>minutes</span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2 text-[11px] text-ink-dim">
                <p className="font-semibold text-ink">Permission prompts from the app</p>
                <p className="leading-4 text-ink-faint">
                  When Claude Code asks permission (run a command, edit a file…), you can Allow or Deny it here - on any machine on the LAN, or your phone. For
                  sessions on another machine, that machine also needs &quot;Replies from my other machines&quot; on (Fleet → Sharing).
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={s.permissions.mode}
                    onChange={(e) => post({ action: "settings", permissions: { mode: e.target.value } })}
                    aria-label="Permission prompts"
                    className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink"
                    disabled={busy}
                  >
                    <option value="off" style={{ background: "var(--color-panel)" }}>Off - always answer at the machine</option>
                    <option value="app" style={{ background: "var(--color-panel)" }}>{`${product}'s own runs (replies, new sessions)`}</option>
                    <option value="all" style={{ background: "var(--color-panel)" }}>All sessions, terminals too</option>
                  </select>
                  {s.permissions.mode === "all" && (
                    <>
                      <span>terminal waits</span>
                      <select
                        value={s.permissions.waitSeconds}
                        onChange={(e) => post({ action: "settings", permissions: { waitSeconds: Number(e.target.value) } })}
                        aria-label="Seconds a terminal waits for an answer from the app"
                        className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink"
                        disabled={busy}
                      >
                        {[15, 30, 60, 120, 300, 600].map((n) => (
                          <option key={n} value={n} style={{ background: "var(--color-panel)" }}>
                            {n < 60 ? `${n} s` : `${n / 60} min`}
                          </option>
                        ))}
                      </select>
                      <span>for an answer, then asks in the terminal</span>
                    </>
                  )}
                </div>
                <p className="leading-4 text-ink-faint">
                  {s.permissions.mode === "off"
                    ? `${product}'s own runs can't ask: anything that needs permission is denied.`
                    : s.permissions.mode === "app"
                      ? `Replies and new sessions started from ${product} wait up to 10 minutes for your answer. Terminal sessions answer in the terminal.`
                      : "While a terminal session waits, its prompt isn't shown at the machine - answer here, or wait it out and answer there."}
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {s && (
            <>
              <Toggle
                on={browser}
                label="Browser notifications (this computer)"
                hint={`Pops up a notification on this computer when a session on any machine needs you or finishes a long run, while a ${product} tab is open.`}
                onClick={toggleBrowser}
              />
              <Toggle
                on={s.telegram.waiting}
                label="Telegram: a session needs me"
                hint="Sent by the master machine, for every machine. Needs Telegram set up (Settings → This network → Telegram)."
                onClick={() => post({ action: "settings", telegram: { waiting: !s.telegram.waiting } })}
                disabled={busy}
              />
              <Toggle
                on={s.telegram.longFinished}
                label="Telegram: a long run finished"
                hint={`When a turn that ran ${s.longMinutes}+ minutes finishes, on any machine.`}
                onClick={() => post({ action: "settings", telegram: { longFinished: !s.telegram.longFinished } })}
                disabled={busy}
              />
              <Toggle
                on={Boolean(s.telegram.permissions)}
                label="Telegram: a permission prompt is waiting"
                hint={`Sent by the machine that's asking, as soon as it asks. Answer in ${product} (any page, or Phone access).`}
                onClick={() => post({ action: "settings", telegram: { permissions: !s.telegram.permissions } })}
                disabled={busy}
              />
              <Toggle
                on={s.telegram.daily}
                label="Telegram: daily summary"
                hint="Each morning: what every machine did yesterday. The note is always written to the vault (Agentic OS/Daily Summaries)."
                onClick={() => post({ action: "settings", telegram: { daily: !s.telegram.daily } })}
                disabled={busy}
              />
              <span className="flex items-center gap-2">
                <SmallButton
                  onClick={async () => {
                    setSummary("Building…");
                    const r = await fetch("/api/hub/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "summary", days: 1 }) });
                    const b = (await r.json()) as { markdown?: string; error?: string };
                    setSummary(b.markdown?.replace(/^---[\s\S]*?\n---\n/, "") ?? b.error ?? "");
                  }}
                >
                  Preview yesterday&apos;s summary
                </SmallButton>
                {summary && <SmallButton onClick={() => setSummary(null)}>Hide</SmallButton>}
              </span>
            </>
          )}
        </div>
        {summary && (
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-line px-4 py-3 text-xs lg:col-span-2">
            <Markdown>{summary}</Markdown>
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * Mounted once in the app shell: while any Mission Control tab is open, pops a
 * browser notification for new needs-you items, if you turned that on.
 */
export function SessionAlertsWatcher() {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || !browserAlertsOn() || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        const r = await fetch("/api/hub/events");
        if (!r.ok) return;
        const v = (await r.json()) as EventsView;
        const first = seen.current === null;
        let stored: string[] = [];
        try {
          stored = JSON.parse(localStorage.getItem("mc-alerts-seen") ?? "[]") as string[];
        } catch {
          stored = [];
        }
        seen.current ??= new Set(stored);
        for (const n of v.needs) {
          if (seen.current.has(n.id)) continue;
          seen.current.add(n.id);
          if (first && stored.length === 0) continue; // first run: don't replay what's already open
          const body = n.reason === "waiting" ? n.message || "Needs your answer" : `Finished after ${Math.round((n.turnMs ?? 0) / 60_000)} min${n.filesChanged ? ` · ${n.filesChanged} files changed` : ""}`;
          const note = new Notification(`${n.hostLabel} · ${n.title}`, { body, tag: n.id });
          note.onclick = () => {
            window.focus();
            window.location.href = `/projects?session=${encodeURIComponent(n.key)}`;
          };
        }
        localStorage.setItem("mc-alerts-seen", JSON.stringify([...seen.current].slice(-300)));
      } catch {
        /* next tick */
      }
    };
    tick();
    const t = setInterval(tick, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return null;
}
