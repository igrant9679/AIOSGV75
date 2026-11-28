"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Markdown from "./Markdown";
import { useMission } from "./store";
import type { LibraryTool } from "@/lib/toolRules";

/** /tools (rule 52): built-in tools, your own, and every Claude skill on this machine, as short forms. */

interface Result { id: string; toolId: string; toolName: string; at: number; engine?: string; input: string; text: string; status: "done" | "running" | "failed" }
interface View { tools: LibraryTool[]; skills: { name: string; description: string }[]; results: Result[]; error?: string }
type Open = { kind: "tool"; tool: LibraryTool } | { kind: "skill"; name: string; description: string } | { kind: "new" } | null;

const field = "w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus:border-[color:var(--ac-violet)]";
const primary = "cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40";
const ghost = "cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim";

export default function ToolsSection() {
  const { system, agents, registry } = useMission();
  const [view, setView] = useState<View | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [engine, setEngine] = useState("");
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [shown, setShown] = useState<Result | null>(null);
  const [draft, setDraft] = useState({ name: "", category: "Mine", blurb: "", prompt: "" });

  const load = useCallback(() => {
    fetch("/api/tools").then((r) => r.json()).then((v: View) => (v.error ? setMsg({ text: v.error, bad: true }) : setView(v))).catch((e: Error) => setMsg({ text: e.message, bad: true }));
  }, []);
  const waiting = view?.results.some((r) => r.status === "running");
  useEffect(() => {
    load();
    const t = setInterval(load, waiting ? 6000 : 60_000);
    return () => clearInterval(t);
  }, [load, waiting]);
  // a result that was running and has now finished shows itself
  useEffect(() => {
    if (shown?.status === "running") {
      const now = view?.results.find((r) => r.id === shown.id);
      if (now && now.status !== "running") setShown(now);
    }
  }, [view, shown]);

  const engines = useMemo(() => [{ v: "", l: "Its usual engine" }, { v: "auto", l: "Auto" }, ...(system?.claudeVersion ? [{ v: "claude", l: "Claude" }] : []), ...agents.filter((a) => a.available && a.id !== "claude").map((a) => ({ v: a.id, l: a.name })), ...registry.llms.filter((l) => l.hasKey).map((l) => ({ v: l.id, l: l.name }))], [system, agents, registry]);
  const cats = useMemo(() => ["All", ...new Set((view?.tools ?? []).map((t) => t.category)), ...(view?.skills.length ? ["Skills"] : [])], [view]);
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const tools = (view?.tools ?? []).filter((t) => (cat === "All" || t.category === cat) && match(`${t.name} ${t.blurb} ${t.category}`));
  const skills = (view?.skills ?? []).filter((s) => (cat === "All" || cat === "Skills") && match(`${s.name} ${s.description}`));

  const post = async (body: object) => (await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const run = async () => {
    if (!open || open.kind === "new") return;
    setBusy(true);
    setMsg(null);
    try {
      const r = open.kind === "tool" ? await post({ action: "run", id: open.tool.id, values, engine: engine || undefined }) : await post({ action: "run-skill", name: open.name, input: values.input ?? "" });
      if (r.error) setMsg({ text: r.error, bad: true });
      else {
        setShown(r.result);
        load();
      }
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
    setBusy(false);
  };
  const pick = (o: Open) => {
    setOpen(o);
    setValues({});
    setEngine("");
    setShown(null);
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const download = (r: Result) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.text], { type: "text/markdown" }));
    a.download = `${r.toolName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a tool (${(view?.tools.length ?? 0) + (view?.skills.length ?? 0)} in the library)`} aria-label="Find a tool" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink outline-none" />
        <span className="studio-seg" style={{ display: "inline-flex", flexWrap: "wrap" }} role="group" aria-label="Category">
          {cats.map((c) => (
            <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>
          ))}
        </span>
        <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} onClick={() => pick({ kind: "new" })}>+ Make a tool</button>
      </div>
      {msg && <p className="text-[12px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>{msg.text}</p>}

      {open && open.kind !== "new" && (
        <div className="panel grid gap-4 p-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink">{open.kind === "tool" ? open.tool.name : open.name}</p>
                <p className="text-[12px] text-ink-dim">{open.kind === "tool" ? open.tool.blurb : open.description || "A Claude skill on this machine."}</p>
              </div>
              <button type="button" className={ghost} onClick={() => setOpen(null)}>Close</button>
            </div>
            {open.kind === "tool" ? (
              open.tool.fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
                  {f.label}{f.required ? "" : " (optional)"}
                  {f.options ? (
                    <select value={values[f.key] ?? f.options[0]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className={field}>
                      {f.options.map((o) => <option key={o} style={{ background: "var(--color-panel)" }}>{o}</option>)}
                    </select>
                  ) : f.long ? (
                    <textarea value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} rows={4} placeholder={f.placeholder} className={field} />
                  ) : (
                    <input value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} className={field} />
                  )}
                </label>
              ))
            ) : (
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
                What do you need from it?
                <textarea value={values.input ?? ""} onChange={(e) => setValues({ input: e.target.value })} rows={5} className={field} />
                <span className="font-normal text-ink-faint">Runs as a Claude Code session on this machine, answer only, using the skill&apos;s own instructions. It can take a few minutes.</span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {open.kind === "tool" && (
                <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Engine" className="h-9 rounded-lg border border-line bg-transparent px-2 text-[12px] text-ink">
                  {engines.map((e) => <option key={e.v} value={e.v} style={{ background: "var(--color-panel)" }}>{e.l}</option>)}
                </select>
              )}
              <span className="flex-1" />
              {open.kind === "tool" && !open.tool.builtin && (
                <button type="button" className={ghost} style={{ color: "var(--ac-rose)" }} onClick={async () => { if (confirm(`Delete ${open.tool.name}?`)) { await post({ action: "delete-tool", id: open.tool.id }); setOpen(null); load(); } }}>Delete tool</button>
              )}
              <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} disabled={busy} onClick={() => void run()}>{busy ? "Working…" : "Run it"}</button>
            </div>
          </div>
          <div className="flex min-h-40 flex-col gap-2 rounded-xl border border-line p-3">
            {!shown && <p className="m-auto text-[12px] text-ink-faint">{busy ? "Working on it…" : "The result lands here, and stays in your saved results."}</p>}
            {shown && (
              <>
                <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                  <span>{shown.status === "running" ? "Running…" : shown.status === "failed" ? "Didn't finish" : `Done${shown.engine ? ` · ${shown.engine}` : ""}`}</span>
                  <span className="flex-1" />
                  {shown.status === "done" && (
                    <>
                      <button type="button" className="cursor-pointer underline" onClick={() => void navigator.clipboard.writeText(shown.text)}>copy</button>
                      <button type="button" className="cursor-pointer underline" onClick={() => download(shown)}>download</button>
                    </>
                  )}
                </div>
                <div className="max-h-[60vh] overflow-y-auto text-[13px]">
                  <Markdown>{shown.status === "running" ? "It is working. This fills in when it finishes." : shown.text || "(no text)"}</Markdown>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {open?.kind === "new" && (
        <div className="panel flex flex-col gap-3 p-4">
          <p className="text-[15px] font-semibold text-ink">Make a tool</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name, e.g. Case study writer" className={field} />
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="Category" className={field} />
          </div>
          <input value={draft.blurb} onChange={(e) => setDraft({ ...draft, blurb: e.target.value })} placeholder="One line: what you get" className={field} />
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-dim">
            The prompt. Put {"{name}"} where an answer goes: each one becomes a box on the form.
            <textarea value={draft.prompt} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} rows={6} placeholder={"Write a case study for {client}.\n\nWhat we did:\n{what_we_did}\n\nResults: {results}"} className={field} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} onClick={async () => { const r = await post({ action: "save-tool", tool: draft }); if (r.error) setMsg({ text: r.error, bad: true }); else { setDraft({ name: "", category: "Mine", blurb: "", prompt: "" }); load(); pick({ kind: "tool", tool: r.tool }); } }}>Save tool</button>
            <button type="button" className={ghost} onClick={() => setOpen(null)}>Cancel</button>
          </div>
          <p className="text-[11px] text-ink-faint">Your tools are kept in the vault, so every machine has them.</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            {tools.map((t) => (
              <button key={t.id} type="button" onClick={() => pick({ kind: "tool", tool: t })} className="panel flex cursor-pointer flex-col gap-1.5 p-4 text-left transition-colors hover:border-[color:var(--ac-violet)]">
                <span className="text-[14px] font-semibold text-ink">{t.name} <span className="text-[11px] font-normal text-ink-faint">{t.category}</span></span>
                <span className="text-[12px] leading-5 text-ink-dim">{t.blurb}</span>
                <span className="text-[11px] text-ink-faint">{t.fields.length} question{t.fields.length === 1 ? "" : "s"} · runs on {t.engine === "auto" ? "the best engine" : t.engine} →</span>
              </button>
            ))}
          </div>
          {skills.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold text-ink">Your Claude skills on this machine <span className="font-normal text-ink-faint">{skills.length}</span></p>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {skills.map((s) => (
                  <button key={s.name} type="button" onClick={() => pick({ kind: "skill", name: s.name, description: s.description })} className="flex cursor-pointer flex-col gap-1 rounded-xl border border-line p-3 text-left transition-colors hover:border-[color:var(--ac-violet)]">
                    <span className="text-[13px] font-semibold text-ink">{s.name}</span>
                    <span className="line-clamp-2 text-[11px] leading-4 text-ink-faint">{s.description || "A Claude skill."}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {view && !tools.length && !skills.length && <p className="text-[13px] text-ink-faint">Nothing matches.</p>}
        </div>
        <div className="panel flex h-fit flex-col gap-2 p-4">
          <p className="text-[13px] font-semibold text-ink">Your saved results</p>
          <p className="text-[11px] text-ink-faint">Kept on this machine. Only you see them.</p>
          {(view?.results ?? []).length === 0 && <p className="py-3 text-center text-[12px] text-ink-faint">Nothing saved yet. Run any tool and the result lands here.</p>}
          {(view?.results ?? []).slice(0, 25).map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-t border-line py-1.5 first:border-t-0">
              <button type="button" onClick={() => { setShown(r); const t = view?.tools.find((x) => x.id === r.toolId); const sk = view?.skills.find((x) => `skill:${x.name}` === r.toolId); setOpen(t ? { kind: "tool", tool: t } : sk ? { kind: "skill", ...sk } : open); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="min-w-0 flex-1 cursor-pointer text-left">
                <span className="block truncate text-[12px] font-semibold text-ink">{r.toolName}</span>
                <span className="block truncate text-[11px] text-ink-faint">{r.status === "running" ? "running…" : r.status === "failed" ? "didn't finish" : new Date(r.at).toLocaleDateString()} · {r.input}</span>
              </button>
              <button type="button" aria-label="Remove" className="cursor-pointer text-[11px] text-ink-faint" onClick={async () => { await post({ action: "delete-result", id: r.id }); load(); }}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
