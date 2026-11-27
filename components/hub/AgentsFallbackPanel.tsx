"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import { ACCENTS } from "@/lib/accents";
import { SmallButton } from "./SessionPanel";

interface Agent {
  id: string;
  label: string;
  command: string;
  args: string[];
  enabled: boolean;
  installed: boolean;
}
interface Preset extends Omit<Agent, "enabled"> {
  added: boolean;
  runsOn: string;
  signIn: string;
  install: string;
}
interface Step {
  step: string;
  label: string;
  ok: boolean;
  why?: string;
}
interface View {
  acp: { agents: Agent[]; presets: Preset[] };
  fallback: { enabled: boolean; order: string[] };
  steps: Step[];
  error?: string;
}

const post = async (body: object): Promise<{ error?: string; ok?: boolean; detail?: string }> => {
  try {
    const r = await fetch("/api/hub/agents-setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return { error: (e as Error).message };
  }
};

/**
 * Fleet → Agents & fallback, for THIS machine: which ACP agents it can run (lib/acpAgents.ts), and
 * what carries a conversation on when a plan hits its limit (lib/fallback.ts). Another machine's
 * settings are changed on that machine: commands are never set from elsewhere.
 */
export default function AgentsFallbackPanel() {
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, { busy?: boolean; ok?: boolean; detail?: string }>>({});
  const [custom, setCustom] = useState({ id: "", label: "", command: "", args: "" });

  const load = useCallback(() => {
    fetch("/api/hub/agents-setup")
      .then((r) => r.json())
      .then((b: View) => (b.error ? setErr(b.error) : setView(b)))
      .catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const saveAgents = async (agents: Omit<Agent, "installed">[]) => {
    setErr(null);
    const r = await post({ action: "acp", agents: agents.map(({ id, label, command, args, enabled }) => ({ id, label, command, args, enabled })) });
    if (r.error) setErr(r.error);
    load();
  };
  const saveFallback = async (v: { enabled?: boolean; order?: string[] }) => {
    setErr(null);
    const r = await post({ action: "fallback", ...v });
    if (r.error) setErr(r.error);
    load();
  };
  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { busy: true } }));
    const r = await post({ action: "acp-test", id });
    setTests((t) => ({ ...t, [id]: { ok: Boolean(r.ok), detail: r.error ?? r.detail } }));
  };

  if (!view) {
    return (
      <Panel title="Agents & fallback · this machine">
        <p className="p-4 font-mono text-[10px] text-ink-faint">{err ?? "Loading…"}</p>
      </Panel>
    );
  }
  const agents = view.acp.agents;
  const order = view.fallback.order;
  const stepOf = (s: string) => view.steps.find((x) => x.step === s);
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    void saveFallback({ order: next });
  };
  const notInOrder = view.steps.filter((s) => !order.includes(s.step));

  return (
    <Panel title="Agents & fallback · this machine">
      <div className="flex flex-col gap-5 p-4 text-xs">
        {/* ── when a plan hits its limit ── */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-[11px] font-semibold text-ink">When a plan hits its limit</h3>
            <label className="flex cursor-pointer items-center gap-1 font-mono text-[10px] text-ink-dim">
              <input type="checkbox" checked={view.fallback.enabled} onChange={(e) => void saveFallback({ enabled: e.target.checked })} /> carry the conversation on with the next tool
            </label>
          </div>
          <p className="text-[10px] leading-4 text-ink-faint">
            A reply or new session here that fails because its plan is at its limit (or the provider is overloaded) goes to the next ready tool below, in the same folder, with the conversation so far. The new session is a normal one: open it to keep going. The local model only answers (it never edits files or keeps a session). Project-run workers are left out: runs place their own tasks.
          </p>
          <ol className="flex flex-col gap-1">
            {order.map((s, i) => {
              const st = stepOf(s);
              return (
                <li key={s} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1">
                  <span className="w-4 font-mono text-[10px] text-ink-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 text-ink">{st?.label ?? s}</span>
                  <span className="font-mono text-[10px]" style={{ color: st?.ok ? ACCENTS.lime.base : ACCENTS.amber.base }}>
                    {st?.ok ? "ready" : (st?.why ?? "unknown")}
                  </span>
                  <SmallButton onClick={() => move(i, -1)} disabled={i === 0} title="Earlier">
                    ↑
                  </SmallButton>
                  <SmallButton onClick={() => move(i, 1)} disabled={i === order.length - 1} title="Later">
                    ↓
                  </SmallButton>
                  <SmallButton onClick={() => void saveFallback({ order: order.filter((x) => x !== s) })} title="Leave it out">
                    ✕
                  </SmallButton>
                </li>
              );
            })}
          </ol>
          {notInOrder.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink-faint">
              add:
              {notInOrder.map((s) => (
                <SmallButton key={s.step} onClick={() => void saveFallback({ order: [...order, s.step] })} title={s.step === "hermes" ? "Hermes may run on Nous credit; add it only if its sign-in is a plan." : s.ok ? "Ready here" : `Not ready: ${s.why}`}>
                  + {s.label}
                </SmallButton>
              ))}
            </div>
          )}
        </section>

        {/* ── ACP agents ── */}
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-[11px] font-semibold text-ink">ACP agents</h3>
          <p className="text-[10px] leading-4 text-ink-faint">
            Agents that speak the Agent Client Protocol become session tools: New session, Run somewhere, Team and the fallback order can use them, and their sessions show on the Projects page. Each runs on its own sign-in, done by you in a terminal; {""}
            Mission Control never signs in for it (Gemini, for one, also offers a billed API key). It answers the agent&apos;s permission requests for you: Answer only allows reading, searching and fetching; Can edit files also allows editing files in the session&apos;s folder; commands and deletions are always refused. An agent whose own settings approve things without asking isn&apos;t stopped by that.
          </p>
          {agents.map((a) => {
            const t = tests[a.id];
            return (
              <div key={a.id} className="flex flex-col gap-1 rounded-lg border border-line px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1">
                    <input type="checkbox" checked={a.enabled} onChange={(e) => void saveAgents(agents.map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked } : x)))} />
                    <span className="text-ink">{a.label}</span>
                  </label>
                  <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-faint">
                    {a.command} {a.args.join(" ")}
                  </code>
                  {!a.installed && (
                    <span className="font-mono text-[10px]" style={{ color: ACCENTS.amber.base }}>
                      not installed
                    </span>
                  )}
                  <SmallButton onClick={() => void test(a.id)} disabled={t?.busy || !a.installed} title="Start it and open a session, without sending anything">
                    {t?.busy ? "Testing…" : "Test"}
                  </SmallButton>
                  <SmallButton onClick={() => void saveAgents(agents.filter((x) => x.id !== a.id))} title="Remove from this machine">
                    ✕
                  </SmallButton>
                </div>
                {t?.detail && (
                  <p className="text-[10px] leading-4" style={{ color: t.ok ? ACCENTS.lime.base : ACCENTS.amber.base }}>
                    {t.detail}
                  </p>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink-faint">
            add:
            {view.acp.presets
              .filter((p) => !p.added)
              .map((p) => (
                <SmallButton
                  key={p.id}
                  onClick={() => void saveAgents([...agents, { id: p.id, label: p.label, command: p.command, args: p.args, enabled: true }])}
                  title={p.installed ? `Runs on: ${p.runsOn}. Sign in: ${p.signIn}` : `Not installed here. Install: ${p.install}`}
                >
                  + {p.label}
                  {p.installed ? "" : " (not installed)"}
                </SmallButton>
              ))}
          </div>
          <details className="text-[10px] text-ink-faint">
            <summary className="cursor-pointer">Another agent (custom command)</summary>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(["id", "label", "command", "args"] as const).map((k) => (
                <input
                  key={k}
                  value={custom[k]}
                  onChange={(e) => setCustom({ ...custom, [k]: e.target.value })}
                  placeholder={k === "id" ? "id (e.g. goose)" : k === "args" ? "arguments, space-separated" : k}
                  aria-label={k}
                  className="rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[10px] text-ink outline-none"
                />
              ))}
              <SmallButton
                accent
                disabled={!custom.id || !custom.command}
                onClick={() => {
                  void saveAgents([...agents, { id: custom.id.trim().toLowerCase(), label: custom.label.trim() || custom.id.trim(), command: custom.command.trim(), args: custom.args.trim() ? custom.args.trim().split(/\s+/) : [], enabled: true }]);
                  setCustom({ id: "", label: "", command: "", args: "" });
                }}
              >
                Add
              </SmallButton>
            </div>
          </details>
        </section>
        {err && (
          <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
            {err}
          </p>
        )}
      </div>
    </Panel>
  );
}
