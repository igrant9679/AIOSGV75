"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import StatusOrb from "../ui/StatusOrb";
import { ACCENTS, type Accent } from "@/lib/accents";
import { ago } from "./common";

interface Build {
  commit: string;
  short: string;
  subject: string;
  at: number;
  branch: string;
  dirty?: boolean;
  builtAt: number;
}

interface UpdateJob {
  id: string;
  status: "queued" | "sent" | "running" | "done" | "error" | "expired";
  reply?: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
  steps: string[];
  requestedByLabel?: string;
}

interface Machine {
  host: string;
  label: string;
  self: boolean;
  online: boolean;
  via?: "lan" | "vault";
  build?: Build;
  selfUpdate?: number;
  updatesAllowed?: boolean;
  acceptsReplies?: string;
  compare: { behind: number; ahead: number } | null;
  job?: UpdateJob;
}

interface VersionsView {
  product: string;
  origin: { branch: string; commit: string; short: string; subject: string; at: number; fetchedAt: number; error?: string } | null;
  machines: Machine[];
  self: { host: string; remoteUpdates: boolean; remoteReplies: string; pendingRestart: boolean; blockers: string[] };
  error?: string;
}

const ACTIVE = ["queued", "sent", "running"];

/** Where a machine stands, in one line, and whether the Update button makes sense. */
function standing(m: Machine, product: string): { text: string; accent: Accent; canUpdate: boolean; why?: string } {
  if (!m.self && !m.selfUpdate) {
    return { text: `older ${product} — run update.cmd there once`, accent: "amber", canUpdate: false, why: "This version can't be updated from another machine yet." };
  }
  if (!m.self && m.acceptsReplies === "off") return { text: "takes no requests from other machines", accent: "amber", canUpdate: false, why: "Its Replies from my other machines setting is Off." };
  if (!m.self && m.updatesAllowed === false) return { text: "updates from other machines are off there", accent: "amber", canUpdate: false, why: "Its Updates from my other machines setting is off." };
  if (!m.build) return { text: "version unknown (built before versions were recorded)", accent: "amber", canUpdate: true };
  if (!m.compare) return { text: `${m.build.short} — not on GitHub's ${m.build.branch || "branch"} (local commits?)`, accent: "violet", canUpdate: true };
  if (m.compare.behind === 0 && m.compare.ahead === 0) return { text: "up to date", accent: "lime", canUpdate: true };
  if (m.compare.ahead > 0) return { text: `${m.compare.ahead} local commit${m.compare.ahead === 1 ? "" : "s"} not on GitHub${m.compare.behind ? `, ${m.compare.behind} behind` : ""}`, accent: "violet", canUpdate: false, why: "It has commits of its own; update it by hand so nothing is lost." };
  return { text: `${m.compare.behind} commit${m.compare.behind === 1 ? "" : "s"} behind`, accent: "amber", canUpdate: true };
}

/**
 * Fleet → Versions: what every machine runs, how far behind GitHub it is, and an Update button
 * that pulls, builds and restarts Mission Control there once nothing is running (lib/selfUpdate.ts).
 */
export default function VersionsPanel() {
  const [view, setView] = useState<VersionsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch(`/api/hub/updates`, init);
      const b = (await r.json()) as VersionsView & { error?: string };
      if (!r.ok) setErr(b.error ?? `HTTP ${r.status}`);
      else {
        setErr(null);
        setView(b);
      }
    } catch {
      /* server restarting: keep the last view */
    }
  }, []);

  const working = view?.machines.some((m) => m.job && ACTIVE.includes(m.job.status)) ?? false;
  useEffect(() => {
    load();
    const t = setInterval(() => load(), working ? 5_000 : 60_000);
    return () => clearInterval(t);
  }, [load, working]);

  const post = async (key: string, body: object) => {
    setBusy(key);
    await load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
  };

  if (!view) return null;
  const product = view.product;
  const behind = view.machines.filter((m) => {
    const s = standing(m, product);
    return s.canUpdate && m.online && m.compare && m.compare.behind > 0 && !(m.job && ACTIVE.includes(m.job.status));
  });
  const updateAll = async () => {
    for (const m of behind) await post(`all:${m.host}`, { action: "update", host: m.host });
  };

  return (
    <Panel
      title="Versions"
      right={
        <span className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-faint">
          {view.origin?.commit ? (
            <span title={view.origin.subject}>
              GitHub {view.origin.branch}: {view.origin.short} · {ago(view.origin.at)} ago · checked {ago(view.origin.fetchedAt)} ago
            </span>
          ) : (
            <span>GitHub not checked yet</span>
          )}
          <button type="button" onClick={() => post("fetch", { action: "fetch" })} disabled={busy !== null} className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50">
            {busy === "fetch" ? "Checking…" : "Check GitHub"}
          </button>
          {behind.length > 1 && (
            <button type="button" onClick={updateAll} disabled={busy !== null} className="cursor-pointer rounded-md border px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50" style={{ borderColor: ACCENTS.amber.border, color: ACCENTS.amber.base }}>
              Update all {behind.length} behind
            </button>
          )}
        </span>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        {(err || view.origin?.error) && <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>{err ?? view.origin?.error}</p>}
        {view.machines.map((m) => {
          const s = standing(m, product);
          const job = m.job;
          const live = job && ACTIVE.includes(job.status);
          const recent = job && !live && job.finishedAt && Date.now() - job.finishedAt < 24 * 60 * 60_000;
          return (
            <div key={m.host} className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusOrb accent={!m.online ? "rose" : live ? "cyan" : s.accent} size={7} pulsing={Boolean(live)} />
                <span className="text-xs font-semibold text-ink">{m.label}</span>
                {m.self && <span className="font-mono text-[10px] text-ink-faint">this machine</span>}
                {!m.online && <span className="font-mono text-[10px]" style={{ color: ACCENTS.rose.base }}>offline</span>}
                <span className="min-w-0 flex-1 font-mono text-[10px] text-ink-faint">
                  {m.build ? (
                    <span title={`${m.build.subject}\nbuilt ${new Date(m.build.builtAt).toLocaleString()}${m.build.dirty ? "\nbuilt with uncommitted changes" : ""}`}>
                      {m.build.short} · {m.build.subject.slice(0, 60)}
                      {m.build.subject.length > 60 ? "…" : ""} · {ago(m.build.at)} ago ·{" "}
                    </span>
                  ) : null}
                  <span style={{ color: ACCENTS[s.accent].base }}>{s.text}</span>
                  {m.self && view.self.pendingRestart && <span style={{ color: ACCENTS.amber.base }}> · a newer build is waiting for a restart</span>}
                </span>
                <button
                  type="button"
                  disabled={busy !== null || !s.canUpdate || Boolean(live) || (!m.online && !m.self)}
                  title={s.why ?? (m.compare && m.compare.behind === 0 ? "Already up to date - runs anyway (rebuilds if the build is stale)" : "Pull, build and restart once nothing is running there")}
                  onClick={() => post(m.host, { action: "update", host: m.host })}
                  className="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40"
                  style={s.canUpdate && m.compare && m.compare.behind > 0 ? { borderColor: ACCENTS.amber.border, color: ACCENTS.amber.base } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
                >
                  {busy === m.host ? "Asking…" : live ? "Updating…" : "Update"}
                </button>
              </div>
              {(live || recent) && job && (
                <div className="pl-4 font-mono text-[10px] leading-4">
                  <span style={{ color: job.status === "done" ? ACCENTS.lime.base : job.status === "error" || job.status === "expired" ? ACCENTS.rose.base : ACCENTS.cyan.base }}>
                    {live ? (job.reply ?? (job.status === "sent" ? "Sent — waiting for it to answer" : "Queued")) : job.status === "done" ? job.reply : job.error}
                  </span>
                  {job.requestedByLabel && <span className="text-ink-faint"> · asked by {job.requestedByLabel}</span>}
                  {!live && job.finishedAt && <span className="text-ink-faint"> · {ago(job.finishedAt)} ago</span>}
                  {live && job.steps.length > 1 && <span className="block text-ink-faint">{job.steps.slice(-4).join(" → ")}</span>}
                </div>
              )}
            </div>
          );
        })}
        <div className="flex flex-col gap-1.5 rounded-xl border px-3 py-2" style={{ borderColor: view.self.remoteUpdates ? ACCENTS.lime.border : "var(--color-line)" }}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-ink">Updates from my other machines</span>
            <button
              type="button"
              disabled={busy !== null}
              aria-pressed={view.self.remoteUpdates}
              onClick={() => post("allow", { action: "allow", value: !view.self.remoteUpdates })}
              className="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] hover:bg-white/[0.06] disabled:opacity-50"
              style={view.self.remoteUpdates ? { borderColor: ACCENTS.lime.border, color: ACCENTS.lime.base } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
            >
              {view.self.remoteUpdates ? "on" : "off"}
            </button>
          </span>
          <span className="text-[10px] leading-4 text-ink-faint">
            Lets your other machines update {product} on this one. An update only installs what is already on this install&apos;s own GitHub branch, waits until
            nothing {product} started is running here{view.self.blockers.length ? ` (right now: ${view.self.blockers.join(", ")})` : ""}, and goes back to
            the previous version if the new one doesn&apos;t build. It also needs Replies from my other machines (Sharing, below) to be on.
          </span>
        </div>
      </div>
    </Panel>
  );
}
