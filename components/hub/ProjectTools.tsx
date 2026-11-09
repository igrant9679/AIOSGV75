"use client";

import { useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import { ACCENTS } from "@/lib/accents";
import type { SessionSummary } from "@/lib/sessions";
import type { HubSnapshot } from "@/lib/activity";
import type { SearchHit } from "@/lib/sessionSearch";
import { launchSurface, LAUNCH_SURFACE_META, LAUNCH_SURFACE_ORDER, type LaunchSurface } from "@/lib/launchSurface";
import { Chip, ago, SourcePill } from "./common";
import { SmallButton, sessionsPost } from "./SessionPanel";

/**
 * Projects page tools: filters you can save ("open sessions on Legion7"),
 * search across every machine's threads, and bulk actions on selected sessions.
 */

export interface SessionFilter {
  host: string;
  tool: "" | "claude" | "codex";
  state: "" | "open" | "closed";
  via: "" | LaunchSurface;
}

const EMPTY: SessionFilter = { host: "", tool: "", state: "", via: "" };
const SAVED_KEY = "mc-saved-filters";

export function applyFilter(list: SessionSummary[], f: SessionFilter): SessionSummary[] {
  return list.filter(
    (s) =>
      (!f.host || s.host === f.host) &&
      (!f.tool || s.tool === f.tool) &&
      (!f.state || (f.state === "open" ? s.status !== "ended" : s.status === "ended")) &&
      (!f.via || launchSurface(s.origin) === f.via),
  );
}

const isEmpty = (f: SessionFilter) => !f.host && !f.tool && !f.state && !f.via;

export function useSessionFilter(hub: HubSnapshot | null) {
  const [filter, setFilter] = useState<SessionFilter>(EMPTY);
  const [saved, setSaved] = useState<{ name: string; filter: SessionFilter }[]>([]);
  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"));
    } catch {
      setSaved([]);
    }
  }, []);
  const persist = (next: { name: string; filter: SessionFilter }[]) => {
    setSaved(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* private window */
    }
  };
  const machines = useMemo(() => {
    const m = new Map<string, string>();
    if (hub) m.set(hub.host, "This machine");
    for (const r of hub?.machines ?? []) m.set(r.host, r.label);
    return [...m.entries()];
  }, [hub]);

  const describe = (f: SessionFilter) =>
    [
      f.state === "open" ? "Open" : f.state === "closed" ? "Closed" : "",
      f.tool === "claude" ? "Claude" : f.tool === "codex" ? "Codex" : "",
      "sessions",
      f.host ? `on ${machines.find(([h]) => h === f.host)?.[1] ?? f.host}` : "",
      f.via ? `· ${LAUNCH_SURFACE_META[f.via].label}` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const sel = "rounded-md border border-line bg-transparent px-1.5 py-1 font-mono text-[10px] text-ink";
  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] text-ink-faint">Show</span>
      <select className={sel} value={filter.state} onChange={(e) => setFilter({ ...filter, state: e.target.value as SessionFilter["state"] })} aria-label="Open or closed">
        <option value="" style={{ background: "var(--color-panel)" }}>open + closed</option>
        <option value="open" style={{ background: "var(--color-panel)" }}>open now</option>
        <option value="closed" style={{ background: "var(--color-panel)" }}>closed</option>
      </select>
      <select className={sel} value={filter.host} onChange={(e) => setFilter({ ...filter, host: e.target.value })} aria-label="Machine">
        <option value="" style={{ background: "var(--color-panel)" }}>every machine</option>
        {machines.map(([h, l]) => (
          <option key={h} value={h} style={{ background: "var(--color-panel)" }}>{l}</option>
        ))}
      </select>
      <select className={sel} value={filter.tool} onChange={(e) => setFilter({ ...filter, tool: e.target.value as SessionFilter["tool"] })} aria-label="Tool">
        <option value="" style={{ background: "var(--color-panel)" }}>Claude + Codex</option>
        <option value="claude" style={{ background: "var(--color-panel)" }}>Claude Code</option>
        <option value="codex" style={{ background: "var(--color-panel)" }}>Codex</option>
      </select>
      <select className={sel} value={filter.via} onChange={(e) => setFilter({ ...filter, via: e.target.value as SessionFilter["via"] })} aria-label="Started in">
        <option value="" style={{ background: "var(--color-panel)" }}>started anywhere</option>
        {LAUNCH_SURFACE_ORDER.map((v) => (
          <option key={v} value={v} style={{ background: "var(--color-panel)" }}>{LAUNCH_SURFACE_META[v].label}</option>
        ))}
      </select>
      {!isEmpty(filter) && (
        <>
          <SmallButton
            onClick={() => {
              const name = describe(filter);
              if (!saved.some((x) => x.name === name)) persist([...saved, { name, filter }]);
            }}
            title="Keep this filter as a one-click chip"
          >
            Save filter
          </SmallButton>
          <SmallButton onClick={() => setFilter(EMPTY)}>Clear</SmallButton>
        </>
      )}
      {saved.map((x) => (
        <span key={x.name} className="flex items-center">
          <Chip active={JSON.stringify(x.filter) === JSON.stringify(filter)} onClick={() => setFilter(x.filter)} title="Saved filter">
            {x.name}
          </Chip>
          <button type="button" onClick={() => persist(saved.filter((y) => y.name !== x.name))} title="Remove this saved filter" className="cursor-pointer px-1 font-mono text-[10px] text-ink-faint hover:text-ink">
            ✕
          </button>
        </span>
      ))}
    </div>
  );
  return { filter, active: !isEmpty(filter), apply: (l: SessionSummary[]) => applyFilter(l, filter), clear: () => setFilter(EMPTY), bar };
}

// ─── search every thread on every machine ───

export function FleetSearch({ onOpen }: { onOpen: (key: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ hits: SearchHit[]; notes: string[] } | null>(null);
  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/hub/search?q=${encodeURIComponent(q.trim())}`);
      setRes(await r.json());
    } catch (e) {
      setRes({ hits: [], notes: [(e as Error).message] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Search every session on every machine">
      <div className="flex flex-col gap-2 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Words from a message, a reply, a command, a file name, an error…"
            aria-label="Search all sessions"
            className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <button type="submit" disabled={busy} className="cursor-pointer rounded-lg border border-line px-3 py-2 font-mono text-[11px] text-ink-dim hover:bg-white/[0.06]">
            {busy ? "Searching…" : "Search"}
          </button>
          {res && (
            <button type="button" onClick={() => setRes(null)} className="cursor-pointer rounded-lg border border-line px-3 py-2 font-mono text-[11px] text-ink-dim hover:bg-white/[0.06]">
              Close
            </button>
          )}
        </form>
        {res && (
          <p className="font-mono text-[10px] text-ink-faint">
            {res.hits.length} session{res.hits.length === 1 ? "" : "s"} · LAN machines search their full threads; others their shared conversations
          </p>
        )}
        {res?.notes.map((n) => (
          <p key={n} className="text-[10px] text-ink-faint">
            {n}
          </p>
        ))}
        <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
          {res?.hits.map((h) => (
            <button
              key={`${h.host}|${h.key}`}
              type="button"
              onClick={() => onOpen(h.key)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-xl border border-line px-3 py-2 text-left transition-colors hover:border-line-bright"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{h.title}</span>
                <SourcePill source={h.tool} />
              </span>
              <span className="font-mono text-[10px] text-ink-faint">
                {h.hostLabel} · {h.project} · {ago(h.updatedAt)} ago · {h.via === "vault" ? "from its shared conversation" : "full thread"}
              </span>
              {h.snippets.map((sn, i) => (
                <span key={i} className="text-[11px] leading-4 text-ink-dim">
                  <span className="font-mono text-[10px]" style={{ color: ACCENTS.cyan.base }}>
                    {sn.role}:
                  </span>{" "}
                  {sn.text}
                </span>
              ))}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ─── bulk actions ───

export function BulkBar({ keys, projectNames, onDone, onClear }: { keys: string[]; projectNames: string[]; onDone: () => void; onClear: () => void }) {
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (body: object, done: string) => {
    setMsg("…");
    const r = await sessionsPost({ ...body, keys });
    setMsg(r.error ?? done);
    if (!r.error) {
      onDone();
      onClear();
    }
  };
  if (!keys.length) return null;
  return (
    <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur" style={{ borderColor: "var(--page-accent)", background: "color-mix(in srgb, var(--color-panel) 92%, transparent)" }}>
      <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--page-accent)" }}>
        {keys.length} selected
      </span>
      <SmallButton onClick={() => act({ action: "hide", hidden: true }, "Hidden.")}>Hide</SmallButton>
      <SmallButton onClick={() => act({ action: "hide", hidden: false }, "Shown again.")}>Unhide</SmallButton>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          act({ action: "move", project: to.trim() }, to.trim() ? `Moved to ${to.trim()}.` : "Back to automatic projects.");
        }}
      >
        <input
          list="mc-bulk-projects"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Move to project…"
          aria-label="Move selected to project"
          className="w-44 rounded-md border border-line bg-transparent px-2 py-1 text-[11px] text-ink outline-none"
        />
        <datalist id="mc-bulk-projects">
          {projectNames.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button type="submit" className="cursor-pointer rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">
          Move
        </button>
      </form>
      <SmallButton onClick={onClear}>Clear selection</SmallButton>
      {msg && <span className="font-mono text-[10px] text-ink-faint">{msg}</span>}
    </div>
  );
}
