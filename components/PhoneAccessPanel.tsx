"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { useProductName } from "./useNetSettings";

interface PhoneView {
  enabled: boolean;
  pinSet: boolean;
  devices: { id: string; created: number; lastSeen: number; agent: string }[];
  port: number;
  listening: boolean;
  urls: string[];
  error?: string;
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const btnCls = "h-9 cursor-pointer rounded-lg border border-line px-3 text-xs text-ink-dim hover:bg-white/[0.06] disabled:opacity-40";

const device = (ua: string) =>
  /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "Mac" : "Browser";
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** Settings → Phone access: the app on your phone over the LAN, behind a PIN (lib/phoneAccess.ts). */
export default function PhoneAccessPanel() {
  const product = useProductName();
  const [v, setV] = useState<PhoneView | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const call = useCallback(async (body?: object, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/phone", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
      const j = (await r.json()) as PhoneView;
      if (!r.ok) setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
      else {
        setV(j);
        if (ok) setMsg({ ok: true, text: ok });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void call();
  }, [call]);

  return (
    <Panel
      title="Phone access"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <StatusOrb accent={v?.enabled ? (v.listening ? "lime" : "rose") : "cyan"} pulsing={false} size={7} />
          {v ? (v.enabled ? (v.listening ? "on" : "on, but the LAN listener isn't running") : "off") : "…"}
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        <p className="text-xs leading-6 text-ink-faint">
          Open {product} on your phone (or any device on this LAN): every page, sessions, replies and permission prompts. It uses the LAN link&apos;s port{" "}
          {v?.port ?? 3101} (already allowed in the firewall) and asks for a PIN. This machine only - turn it on on each machine you want to reach.
        </p>
        {msg && (
          <div role={msg.ok ? "status" : "alert"} className={`rounded-lg border px-3 py-2 font-mono text-xs ${msg.ok ? "border-neon-lime/30 bg-neon-lime/10 text-neon-lime" : "border-neon-rose/30 bg-neon-rose/10 text-neon-rose"}`}>
            {msg.text}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint" htmlFor="phone-pin">
              {v?.pinSet ? "NEW PIN (signs out every phone)" : "PIN (6+ characters)"}
            </label>
            <input id="phone-pin" type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder={v?.pinSet ? "PIN is set" : "e.g. a 6-digit number"} className={inputCls} />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              disabled={busy || pin.trim().length < 6}
              onClick={async () => {
                await call({ pin }, "PIN saved.");
                setPin("");
              }}
              className={btnCls}
            >
              Save PIN
            </button>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
          <input
            type="checkbox"
            checked={Boolean(v?.enabled)}
            disabled={busy || !v?.pinSet}
            onChange={(e) => call({ enabled: e.target.checked }, e.target.checked ? "Phone access is on." : "Phone access is off.")}
            className="cursor-pointer accent-current"
          />
          Turn on phone access for this machine {!v?.pinSet && <span className="text-ink-faint">(set a PIN first)</span>}
        </label>

        {v?.enabled && (
          <div className="rounded-xl border border-line bg-white/[0.02] p-3">
            <p className="mb-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">OPEN ON YOUR PHONE (same Wi-Fi / LAN)</p>
            {v.urls.length ? (
              v.urls.map((u) => (
                <p key={u} className="break-all font-mono text-sm text-ink">
                  {u}
                </p>
              ))
            ) : (
              <p className="text-[11px] text-ink-faint">This machine has no LAN address right now.</p>
            )}
            <p className="mt-2 text-[11px] leading-5 text-ink-faint">
              Then &quot;Add to Home Screen&quot; for an app icon. Away from home: with Tailscale on this computer and your phone, open http://&lt;this
              computer&apos;s Tailscale IP&gt;:{v.port}/ - no ports opened to the internet.
            </p>
          </div>
        )}

        {v && v.devices.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="font-mono text-[10px] tracking-[0.14em] text-ink-faint">SIGNED-IN DEVICES ({v.devices.length})</p>
            {v.devices.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-dim">
                <span className="flex-1">
                  {device(d.agent)} · signed in {ago(d.created)} · last used {ago(d.lastSeen)}
                </span>
                <button type="button" disabled={busy} onClick={() => call({ removeDevice: d.id }, "Signed that device out.")} className="cursor-pointer font-mono text-[10px] underline">
                  sign out
                </button>
              </div>
            ))}
            <button type="button" disabled={busy} onClick={() => call({ signOutAll: true }, "Signed every device out.")} className={`${btnCls} self-start`}>
              Sign out all devices
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
