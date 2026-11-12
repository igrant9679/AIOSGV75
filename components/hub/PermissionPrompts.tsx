"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACCENTS } from "@/lib/accents";
import type { PermissionRequest } from "@/lib/permissions";

/**
 * Permission prompts waiting on any machine (lib/permissions.ts), shown on every page:
 * Allow / Always allow / Deny. Mounted once in the app shell.
 */
export default function PermissionPrompts() {
  const [items, setItems] = useState<PermissionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [, tick] = useState(0);
  const notified = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hub/permissions", { cache: "no-store" });
      if (!r.ok) return;
      const b = (await r.json()) as { items?: PermissionRequest[] };
      const list = b.items ?? [];
      setItems(list);
      // browser notification for new ones (if this computer allows notifications)
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && localStorage.getItem("mc-browser-alerts") === "on") {
        for (const p of list) {
          if (notified.current.has(p.id)) continue;
          notified.current.add(p.id);
          const n = new Notification(`Permission needed · ${p.hostLabel}`, { body: p.summary, tag: `perm-${p.id}`, requireInteraction: true });
          n.onclick = () => window.focus();
        }
      } else list.forEach((p) => notified.current.add(p.id));
    } catch {
      /* next tick */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
      tick((n) => n + 1);
    }, 2_500);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (p: PermissionRequest, behavior: "allow" | "deny", always = false) => {
    setBusy(p.id);
    try {
      const r = await fetch("/api/hub/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decide", host: p.host, id: p.id, behavior, always }),
      });
      const b = (await r.json()) as { error?: string };
      if (!r.ok) setErr((e) => ({ ...e, [p.id]: b.error ?? `HTTP ${r.status}` }));
      else setItems((list) => list.filter((x) => x.id !== p.id));
    } catch (e) {
      setErr((x) => ({ ...x, [p.id]: (e as Error).message }));
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (!items.length) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-[26rem]" role="region" aria-label="Permission prompts">
      {items.slice(0, 4).map((p) => {
        const left = Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000));
        const where = p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? p.cwd;
        return (
          <div key={p.id} className="rounded-2xl border bg-panel p-3 shadow-xl" style={{ borderColor: ACCENTS.amber.base }}>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: ACCENTS.amber.base }} />
              <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">Claude wants permission · {p.hostLabel}</p>
              <span className="font-mono text-[10px] text-ink-faint" title="After this it goes back to the terminal (or is denied for a run with nobody at a terminal)">
                {left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-ink-faint">
              {where}
              {p.headless ? " · a run started from the app" : " · terminal session"}
            </p>
            <p className="mt-2 break-words rounded-lg bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-ink">{p.summary}</p>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))} className="mt-1 cursor-pointer font-mono text-[10px] text-ink-faint underline">
              {open[p.id] ? "hide details" : `details (${p.toolName})`}
            </button>
            {open[p.id] && <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-black/[0.06] p-2 font-mono text-[10px] text-ink-dim">{p.input}</pre>}
            {err[p.id] && <p className="mt-1 text-[11px]" style={{ color: ACCENTS.rose.base }}>{err[p.id]}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy === p.id}
                onClick={() => decide(p, "allow")}
                className="h-8 flex-1 cursor-pointer rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: ACCENTS.lime.base }}
              >
                Allow
              </button>
              {p.suggestions && (
                <button
                  type="button"
                  disabled={busy === p.id}
                  onClick={() => decide(p, "allow", true)}
                  title="Allow, and add Claude Code's suggested rule so it doesn't ask again for this"
                  className="h-8 cursor-pointer rounded-lg border border-line px-3 text-xs text-ink-dim hover:bg-white/[0.06] disabled:opacity-40"
                >
                  Always allow
                </button>
              )}
              <button
                type="button"
                disabled={busy === p.id}
                onClick={() => decide(p, "deny")}
                className="h-8 cursor-pointer rounded-lg border px-3 text-xs disabled:opacity-40"
                style={{ borderColor: ACCENTS.rose.base, color: ACCENTS.rose.base }}
              >
                Deny
              </button>
              <a href={`/projects?session=${encodeURIComponent(p.key)}`} className="flex h-8 items-center px-1 font-mono text-[10px] text-ink-faint underline">
                session
              </a>
            </div>
          </div>
        );
      })}
      {items.length > 4 && <p className="text-right font-mono text-[10px] text-ink-faint">+ {items.length - 4} more waiting</p>}
    </div>
  );
}
