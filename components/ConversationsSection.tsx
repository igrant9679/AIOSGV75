"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import Avatar from "./Avatar";
import Markdown from "./Markdown";
import { IconBook } from "./icons";

const VAULT_NAME = "IdrisGV75";

interface Facet { key: string; count: number }
interface Result {
  id: string;
  agent: string;
  date: string;
  time: string;
  host: string;
  title: string;
  snippet: string;
  turns: number;
  wordCount: number;
  file: string;
  body: string;
  score: number;
}

function relTime(date: string, time: string): string {
  const t = Date.parse(`${date}T${time}`);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
interface Payload {
  results: Result[];
  facets: { agents: Facet[]; hosts: Facet[]; dates: Facet[] };
  total: number;
  vaultOk: boolean;
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

function highlight(text: string, q: string) {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-neon-amber/25 px-0.5 text-ink">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function ConversationsSection() {
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("");
  const [host, setHost] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (query: string, ag: string, ho: string) => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (query.trim()) p.set("q", query.trim());
      if (ag) p.set("agent", ag);
      if (ho) p.set("host", ho);
      const res = await fetch(`/api/conversations?${p.toString()}`);
      if (res.ok) setData((await res.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("", "", "");
  }, [load]);

  // debounce the query; filters apply immediately
  useEffect(() => {
    const t = setTimeout(() => load(q, agent, host), 250);
    return () => clearTimeout(t);
  }, [q, agent, host, load]);

  const results = data?.results ?? [];
  const totalLabel = useMemo(() => {
    if (!data) return "";
    const shown = results.length;
    return data.total > shown ? `${shown} of ${data.total}` : `${data.total}`;
  }, [data, results.length]);

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
      active ? "border-neon-cyan bg-neon-cyan/10 text-neon-cyan" : "border-line text-ink-dim hover:bg-white/[0.05]"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Search Conversations" right={<span className="font-mono text-[10px] text-ink-faint">across every agent · all machines</span>}>
        <div className="flex flex-col gap-3 p-5">
          <p className="text-xs leading-5 text-ink-faint">
            Search everything you&apos;ve discussed with any agent — by topic or keyword. Results show which agent, when,
            and on which machine, with your question and the agent&apos;s answer. Open any one in Obsidian to keep working on it.
          </p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics or keywords…  e.g. rust ownership, marketing plan, postgres index" className={inputCls} autoFocus />

          {/* facet filters */}
          {data && (
            <div className="flex flex-col gap-2">
              {data.facets.agents.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={labelCls + " mb-0 mr-1"}>AGENT</span>
                  <button className={chip(agent === "")} onClick={() => setAgent("")}>all</button>
                  {data.facets.agents.map((f) => (
                    <button key={f.key} className={chip(agent === f.key)} onClick={() => setAgent(agent === f.key ? "" : f.key)}>
                      {f.key} <span className="text-ink-faint">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {data.facets.hosts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={labelCls + " mb-0 mr-1"}>MACHINE</span>
                  <button className={chip(host === "")} onClick={() => setHost("")}>all</button>
                  {data.facets.hosts.map((f) => (
                    <button key={f.key} className={chip(host === f.key)} onClick={() => setHost(host === f.key ? "" : f.key)}>
                      🖥 {f.key} <span className="text-ink-faint">{f.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Results" delay={0.05} right={<span className="font-mono text-[10px] text-ink-faint">{loading ? "searching…" : totalLabel}</span>}>
        <div className="flex flex-col gap-2 p-4">
          {data && !data.vaultOk && <p className="py-6 text-center text-xs text-neon-rose">Vault not reachable — conversations live in the synced vault.</p>}
          {data && data.vaultOk && results.length === 0 && (
            <p className="py-8 text-center text-xs text-ink-faint">{q.trim() ? `No conversations match “${q}”.` : "No conversations yet — chat with an agent and it's saved here."}</p>
          )}
          {results.map((r) => {
            const isOpen = open === r.id;
            const obsidian = `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(r.file)}`;
            return (
              <div key={r.id} className="rounded-xl border border-line bg-white/[0.02]">
                <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full cursor-pointer items-start gap-3 p-3 text-left">
                  <Avatar name={r.agent} accent="cyan" size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{highlight(r.title, q)}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-ink-dim">{highlight(r.snippet, q)}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-ink-faint">
                      <span className="font-semibold text-neon-cyan">{r.agent}</span>
                      <span>{r.date} · {r.time}</span>
                      <span className="text-ink-dim">{relTime(r.date, r.time)}</span>
                      <span className={r.host ? "text-ink-dim" : ""}>🖥 {r.host || "unknown"}</span>
                      {r.turns > 1 && <span>{r.turns} turns</span>}
                      <span>{r.wordCount} words</span>
                    </p>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-line p-4">
                    <div className="max-h-[28rem] overflow-y-auto pr-1">
                      <Markdown>{r.body}</Markdown>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <a href={obsidian} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-neon-violet">
                        <IconBook width={13} height={13} /> Open in Obsidian
                      </a>
                      <span className="font-mono text-[10px] text-ink-faint">{r.file}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
