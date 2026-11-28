"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "./Markdown";
import { scheduleText, type FleetAgent, type AgentSchedule, type AgentTool } from "@/lib/fleetAgentRules";

/** /agents (rule 50): the owner's own standing agents — make one, run it, schedule it, see how it went. */

type Template = Pick<FleetAgent, "name" | "icon" | "persona" | "task" | "tool" | "access" | "web" | "subAgents" | "schedule">;
type Draft = Partial<FleetAgent> & { name: string; task: string };
interface View { agents: FleetAgent[]; templates: Template[]; machines: { host: string; label: string; ok: boolean; why?: string }[]; error?: string }

const EMPTY: Draft = { name: "", icon: "🤖", persona: "", task: "", tool: "claude", machine: "auto", folder: "~", access: "answer", web: true, subAgents: 0, schedule: null, enabled: true };
const TOOL_NAME: Record<AgentTool, string> = { claude: "Claude Code", codex: "Codex", hermes: "Hermes" };
const field = "w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus:border-[color:var(--ac-violet)]";
const primary = "cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40";
const ghost = "cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim disabled:opacity-40";
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function AgentsFleetSection() {
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch("/api/fleet-agents").then((r) => r.json()).then((v: View) => (v.error ? setMsg({ text: v.error, bad: true }) : setView(v))).catch((e: Error) => setMsg({ text: e.message, bad: true }));
  }, []);
  const running = view?.agents.some((a) => a.runs?.[0]?.status === "started");
  useEffect(() => {
    load();
    const t = setInterval(load, running ? 6000 : 30_000);
    return () => clearInterval(t);
  }, [load, running]);
  const call = async (name: string, body: object, ok: string) => {
    setBusy(name);
    setMsg(null);
    try {
      const r = await (await fetch("/api/fleet-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
      setMsg(r.error ? { text: r.error, bad: true } : { text: ok });
      if (!r.error) load();
      return !r.error;
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const sched = draft?.schedule ?? null;
  const setSched = (p: Partial<AgentSchedule> | null) => set({ schedule: p === null ? null : { freq: "daily", time: "08:00", ...(sched ?? {}), ...p } });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] text-ink-faint">Each run is an ordinary session on a machine, so it follows that machine&apos;s own rules and shows on the Board.</p>
        <span className="flex-1" />
        <Link href="/city" className="studio-chip" style={{ display: "inline-flex" }}>See them at work</Link>
        <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} onClick={() => setDraft({ ...EMPTY })}>+ New agent</button>
      </div>
      {msg && <p className="text-[12px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>{msg.text}</p>}

      {draft && (
        <div className="panel grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-3">
            <p className="text-[15px] font-semibold text-ink">{draft.id ? `Edit ${draft.name}` : "New agent"}</p>
            <div className="flex gap-2">
              <input value={draft.icon ?? ""} onChange={(e) => set({ icon: e.target.value })} aria-label="Icon (an emoji)" className={`${field} w-16 text-center`} maxLength={4} />
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name, e.g. Morning Brief" aria-label="Name" className={field} />
            </div>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
              <span className="flex items-center gap-2">Persona (who it is and how it works) <button type="button" className="font-normal underline" onClick={() => fileRef.current?.click()}>load a .md file</button></span>
              <textarea value={draft.persona ?? ""} onChange={(e) => set({ persona: e.target.value })} rows={3} placeholder="You are a patient scout. You only keep leads that match the niche, and you say plainly why each one made the list." className={field} />
              <input ref={fileRef} type="file" accept=".md,.txt,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) set({ persona: (await f.text()).slice(0, 6000) }); }} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
              Standing task (say the whole job; you can add a note for each run)
              <textarea value={draft.task} onChange={(e) => set({ task: e.target.value })} rows={4} placeholder="Every morning, read the new issues in the usip repository and list the ones that need me, most urgent first." className={field} />
              <span className="self-end font-normal text-ink-faint">{draft.task.length} of 4,000</span>
            </label>
            <div className="flex flex-wrap items-center gap-4 text-[12px] text-ink-dim">
              <label className="flex items-center gap-2">
                Sub agents
                <button type="button" className={ghost} onClick={() => set({ subAgents: Math.max(0, (draft.subAgents ?? 0) - 1) })} aria-label="Fewer">−</button>
                <b className="w-4 text-center text-ink">{draft.subAgents ?? 0}</b>
                <button type="button" className={ghost} onClick={() => set({ subAgents: Math.min(5, (draft.subAgents ?? 0) + 1) })} aria-label="More">+</button>
                <span className="text-ink-faint">{draft.subAgents ? "the most helpers in one run" : "0 = it works alone"}</span>
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-[12px] text-ink">
                <input type="checkbox" checked={draft.web !== false} onChange={(e) => set({ web: e.target.checked })} className="mt-0.5" />
                <span><b>Web</b><br /><span className="text-ink-faint">Look things up and read pages</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-[12px] text-ink">
                <input type="checkbox" checked={draft.access === "edit"} onChange={(e) => set({ access: e.target.checked ? "edit" : "answer" })} className="mt-0.5" />
                <span><b>Change files and run commands</b><br /><span className="text-ink-faint">Off = it answers in writing only. The machine must allow it too.</span></span>
              </label>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-[13px] font-semibold text-ink">Where it runs</p>
            {(["claude", "codex", "hermes"] as const).map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-[13px] text-ink" style={{ borderColor: draft.tool === t ? "var(--ac-violet)" : "var(--tone-line)" }}>
                <input type="radio" name="ag-tool" checked={draft.tool === t} onChange={() => set({ tool: t })} /> <b>{TOOL_NAME[t]}</b>
                <span className="text-[11px] text-ink-faint">{t === "claude" ? "best for builds and careful work" : t === "codex" ? "your ChatGPT plan" : "free models, good for research"}</span>
              </label>
            ))}
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
              Machine
              <select value={draft.machine ?? "auto"} onChange={(e) => set({ machine: e.target.value })} className={field}>
                <option value="auto" style={{ background: "var(--color-panel)" }}>Auto: the best machine at the time</option>
                {(view?.machines ?? []).map((m) => (
                  <option key={m.host} value={m.host} style={{ background: "var(--color-panel)" }}>{m.label}{m.why ? ` · ${m.why}` : ""}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
              Folder
              <input value={draft.folder ?? "~"} onChange={(e) => set({ folder: e.target.value })} className={field} />
              <span className="font-normal text-ink-faint">~ is the home folder. A project folder must be one that machine&apos;s sessions already use.</span>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
              Schedule
              <span className="flex gap-2">
                <select value={sched?.freq ?? ""} onChange={(e) => setSched(e.target.value ? { freq: e.target.value as AgentSchedule["freq"] } : null)} className={field}>
                  <option value="" style={{ background: "var(--color-panel)" }}>Only when I press Run</option>
                  <option value="hourly" style={{ background: "var(--color-panel)" }}>Every hour</option>
                  <option value="daily" style={{ background: "var(--color-panel)" }}>Every day</option>
                  <option value="weekdays" style={{ background: "var(--color-panel)" }}>Weekdays</option>
                  <option value="weekly" style={{ background: "var(--color-panel)" }}>Weekly</option>
                </select>
                {sched && sched.freq !== "hourly" && <input type="time" value={sched.time} onChange={(e) => setSched({ time: e.target.value })} className={`${field} w-32`} aria-label="Time" />}
              </span>
              {sched?.freq === "weekly" && (
                <select value={sched.weekday ?? 1} onChange={(e) => setSched({ weekday: Number(e.target.value) })} className={field} aria-label="Day">
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                    <option key={d} value={i} style={{ background: "var(--color-panel)" }}>{d}</option>
                  ))}
                </select>
              )}
              <span className="font-normal text-ink-faint">Scheduled runs are started by the master machine and wait while the fleet is paused.</span>
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} disabled={busy === "save"} onClick={async () => { if (await call("save", { action: "save", agent: draft }, `${draft.name} saved.`)) setDraft(null); }}>
                {busy === "save" ? "Saving…" : draft.id ? "Save" : "Create agent"}
              </button>
              <button type="button" className={ghost} onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {view && view.agents.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {view.agents.map((a) => {
            const last = a.runs?.[0];
            const machine = a.machine === "auto" ? "best machine" : (view.machines.find((m) => m.host === a.machine)?.label ?? a.machine);
            return (
              <div key={a.id} className="panel flex flex-col gap-2 p-4" style={{ opacity: a.enabled ? 1 : 0.6 }}>
                <div className="flex items-center gap-2">
                  <span className="text-xl">{a.icon}</span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[14px] text-ink">{a.name}</b>
                    <span className="block truncate text-[11px] text-ink-faint">{TOOL_NAME[a.tool]} · {machine} · {a.access === "edit" ? "may change files" : "answer only"} · {scheduleText(a.schedule)}</span>
                  </span>
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-ink-faint" title="Scheduled runs on or off">
                    <input type="checkbox" checked={a.enabled} onChange={(e) => void call(`en-${a.id}`, { action: "enable", id: a.id, enabled: e.target.checked }, e.target.checked ? "Switched on." : "Switched off.")} /> on
                  </label>
                </div>
                <p className="line-clamp-2 text-[12px] leading-5 text-ink-dim">{a.task}</p>
                {last && (
                  <p className="text-[11px]" style={{ color: last.status === "failed" ? "var(--ac-rose)" : last.status === "started" ? "var(--ac-violet)" : "var(--color-ink-faint)" }}>
                    {last.status === "started" ? "Running" : last.status === "done" ? "Finished" : "Didn't finish"} {ago(last.at)}{last.hostLabel ? ` on ${last.hostLabel}` : ""}{last.scheduled ? " (scheduled)" : ""}
                    {last.summary && <button type="button" className="ml-2 underline" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? "hide" : "show the result"}</button>}
                    {last.note && <span className="block" style={{ color: "var(--ac-amber)" }}>{last.note} Sign that machine in, or pick a machine for this agent.</span>}
                  </p>
                )}
                {open === a.id && last?.summary && (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-line px-3 py-2 text-[12px]">
                    <Markdown>{last.summary}</Markdown>
                    {last.key && <Link href={`/projects?session=${encodeURIComponent(last.key)}`} className="text-[11px] underline">open the session</Link>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} placeholder="A note for this run (optional)" aria-label={`Note for ${a.name}`} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-2 text-[12px] text-ink outline-none" />
                  <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} disabled={busy === `run-${a.id}` || last?.status === "started"} onClick={() => void call(`run-${a.id}`, { action: "run", id: a.id, note: note[a.id] }, `${a.name} started.`).then((ok) => ok && setNote({ ...note, [a.id]: "" }))}>
                    {busy === `run-${a.id}` ? "Starting…" : "Run"}
                  </button>
                  <button type="button" className={ghost} onClick={() => setDraft({ ...a })}>Edit</button>
                  <button type="button" className={ghost} style={{ color: "var(--ac-rose)" }} onClick={() => confirm(`Delete ${a.name}?`) && void call(`del-${a.id}`, { action: "delete", id: a.id }, "Deleted.")}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel flex flex-col gap-3 p-4">
        <p className="text-[14px] font-semibold text-ink">{view?.agents.length ? "Start from one of these" : "No agents yet. Start from one of these, or make your own."}</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {(view?.templates ?? []).map((t) => (
            <div key={t.name} className="flex flex-col gap-1.5 rounded-xl border border-line p-3">
              <p className="text-[13px] font-semibold text-ink">{t.icon} {t.name}</p>
              <p className="line-clamp-3 text-[12px] leading-5 text-ink-dim">{t.task}</p>
              <p className="text-[11px] text-ink-faint">{TOOL_NAME[t.tool]} · {scheduleText(t.schedule)}</p>
              <button type="button" className={`${ghost} self-end`} onClick={() => { setDraft({ ...EMPTY, ...t }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>+ Add</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
