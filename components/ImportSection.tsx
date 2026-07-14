"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconRocket, IconSpark, IconCheck } from "./icons";
import { useMission } from "./store";

interface SampleRow {
  id: string;
  source: "chatgpt" | "claude";
  title: string;
  messageCount: number;
  createdAt: number;
  processed: boolean;
}
interface ImportJob {
  status: "idle" | "running" | "done" | "error";
  processed: number;
  total: number;
  error?: string;
  note?: string;
}
interface Summary {
  exportsDir: string;
  scannedAt: number;
  vaultOk: boolean;
  sources: Record<string, number>;
  total: number;
  processed: number;
  messages: number;
  words: number;
  oldest: number;
  newest: number;
  job: ImportJob;
  sample: SampleRow[];
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const fmtNum = (n: number) => n.toLocaleString();
const SOURCE_LABEL: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude" };

export default function ImportSection() {
  const { registry, agents, addEvent } = useMission();
  const [sum, setSum] = useState<Summary | null>(null);
  const [writer, setWriter] = useState("claude");
  const [max, setMax] = useState(40);
  const [everything, setEverything] = useState(false);
  const [busy, setBusy] = useState<"scan" | "distill" | "reset" | null>(null);
  const [err, setErr] = useState("");

  // Every agent that can actually run on THIS machine: Claude + the router,
  // installed built-ins (Hermes/OpenClaw/Codex), keyed/local LLMs, and custom
  // command agents. The registry is per-machine — add models in Settings to
  // grow this list.
  const agentOptions = [
    { id: "claude", name: "Claude" },
    { id: "auto", name: "Auto (router)" },
    ...agents.filter((a) => a.available).map((a) => ({ id: a.id, name: a.name })),
    ...registry.llms.filter((l) => l.hasKey).map((l) => ({ id: l.id, name: l.name })),
    ...registry.commandAgents.map((c) => ({ id: c.id, name: c.name })),
  ].filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/import");
      if (res.ok) setSum((await res.json()) as Summary);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const running = sum?.job.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3500);
    return () => clearInterval(t);
  }, [running, load]);

  const call = async (action: "scan" | "distill" | "reset") => {
    setErr("");
    setBusy(action);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, writer, max: everything ? 0 : max }),
      });
      const j = (await res.json()) as Summary & { error?: string };
      if (!res.ok || j.error) setErr(j.error ?? `${action} failed`);
      else {
        setSum(j);
        if (action === "scan") addEvent("IMPORT", `Scanned ${j.total} conversations`, "cyan");
        if (action === "distill") addEvent("IMPORT", j.job.status === "running" ? `Distilling ${j.job.total} conversations` : j.job.note ?? "distill", "violet");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const unprocessed = sum ? sum.total - sum.processed : 0;

  return (
    <div className="flex flex-col gap-4">
      {sum && !sum.vaultOk && (
        <div role="alert" className="rounded-xl border border-neon-rose/30 bg-neon-rose/10 px-4 py-2.5 font-mono text-xs text-neon-rose">
          Vault not reachable — distilled notes are written to the Obsidian vault, so check VAULT_DIR.
        </div>
      )}
      {err && (
        <div role="alert" className="rounded-xl border border-neon-rose/30 bg-neon-rose/10 px-4 py-2.5 font-mono text-xs text-neon-rose">
          {err}
        </div>
      )}

      {/* how it works */}
      <Panel title="Import AI Chat History">
        <div className="flex flex-col gap-3 p-5">
          <p className="text-xs leading-6 text-ink-dim">
            Fold your past ChatGPT and Claude conversations into the brain. Export your data from each provider
            (<span className="text-ink">ChatGPT → Settings → Data Controls → Export</span>;{" "}
            <span className="text-ink">Claude → Settings → Privacy → Export</span>), then drop the ZIP — or the extracted{" "}
            <span className="font-mono">conversations.json</span> — into this folder and Scan:
          </p>
          <code className="block truncate rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-neon-cyan">
            {sum?.exportsDir ?? "…"}
          </code>
          <div className="flex flex-wrap items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => call("scan")}
              disabled={busy !== null}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-cyan-600 to-neon-cyan px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconSpark width={15} height={15} /> {busy === "scan" ? "Scanning…" : "Scan exports"}
            </motion.button>
            {sum && sum.scannedAt > 0 && (
              <span className="font-mono text-[10px] text-ink-faint">last scan {fmtDate(sum.scannedAt)} · ZIPs auto-extract on Windows</span>
            )}
          </div>
        </div>
      </Panel>

      {/* stats + distill */}
      {sum && sum.total > 0 ? (
        <>
          <Panel title="Found" delay={0.05}>
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              {[
                { k: "conversations", v: fmtNum(sum.total) },
                { k: "messages", v: fmtNum(sum.messages) },
                { k: "words", v: fmtNum(sum.words) },
                { k: "date range", v: `${fmtDate(sum.oldest)} → ${fmtDate(sum.newest)}` },
              ].map((s) => (
                <div key={s.k} className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <p className="text-lg font-semibold text-ink">{s.v}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{s.k}</p>
                </div>
              ))}
              <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-4">
                {Object.entries(sum.sources).map(([src, n]) => (
                  <span key={src} className="rounded-full border border-line bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-ink-dim">
                    {SOURCE_LABEL[src] ?? src}: {fmtNum(n)}
                  </span>
                ))}
                <span className="rounded-full border border-line bg-white/[0.03] px-3 py-1 font-mono text-[11px] text-neon-lime">
                  {fmtNum(sum.processed)} distilled · {fmtNum(unprocessed)} remaining
                </span>
              </div>
            </div>
          </Panel>

          <Panel title="Distill to the Vault" delay={0.1} right={<span className="font-mono text-[10px] text-ink-faint">Agentic OS/History</span>}>
            <div className="flex flex-col gap-3 p-5">
              <p className="text-xs leading-5 text-ink-faint">
                The chosen writer condenses your conversations into topic-grouped Markdown notes (durable facts, decisions,
                preferences) in the vault, where they become searchable and feed every agent&apos;s memory. Each note gets{" "}
                <span className="text-neon-cyan">tags</span> in its frontmatter and{" "}
                <span className="text-neon-cyan">[[wikilinks]]</span> into your existing notes, plus an{" "}
                <span className="font-mono">Imported History Index</span> hub — so it joins the knowledge graph instead of
                sitting in it as an orphan. Runs the richest conversations first, in batches — set a cap so cost stays
                bounded. Resumable: re-run to continue.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[10rem]">
                  <label className={labelCls} htmlFor="im-writer">WRITER</label>
                  <select id="im-writer" value={writer} onChange={(e) => setWriter(e.target.value)} className={`${inputCls} cursor-pointer`}>
                    {agentOptions.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  <label className={labelCls} htmlFor="im-max">MAX THIS RUN</label>
                  <input
                    id="im-max"
                    type="number"
                    min={1}
                    max={500}
                    value={max}
                    onChange={(e) => setMax(Number(e.target.value))}
                    disabled={everything}
                    className={`${inputCls} disabled:opacity-40`}
                  />
                </div>
                <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 font-mono text-[10px] text-ink-dim">
                  <input
                    type="checkbox"
                    checked={everything}
                    onChange={(e) => setEverything(e.target.checked)}
                    className="cursor-pointer accent-current"
                  />
                  EVERYTHING ({fmtNum(unprocessed)})
                </label>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => call("distill")}
                  disabled={busy !== null || running || unprocessed === 0}
                  className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-violet-700 to-neon-violet px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <IconRocket width={15} height={15} />{" "}
                  {running ? "Distilling…" : `Distill ${everything ? fmtNum(unprocessed) : fmtNum(Math.min(max, unprocessed))}`}
                </motion.button>
                {sum.processed > 0 && (
                  <button
                    onClick={() => call("reset")}
                    disabled={busy !== null || running}
                    className="h-10 cursor-pointer rounded-lg border border-line px-3 text-xs text-ink-faint transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    Reset processed
                  </button>
                )}
              </div>
              {everything && unprocessed > 0 && (
                <p className="font-mono text-[10px] leading-4 text-neon-amber">
                  ≈ {fmtNum(Math.ceil(unprocessed / 12))} writer call(s) ({fmtNum(unprocessed)} conversations, batches of
                  12). Free with a local writer like Llama; with Claude this is real spend. Resumable either way — you can
                  stop the server and re-run to continue.
                </p>
              )}

              {/* progress / result */}
              {running && (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.div
                      className="h-full rounded-full bg-neon-violet"
                      animate={{ width: `${sum.job.total ? (sum.job.processed / sum.job.total) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="font-mono text-[10px] text-ink-faint">{sum.job.processed}/{sum.job.total} distilled…</p>
                </div>
              )}
              {sum.job.status === "done" && sum.job.note && (
                <p className="flex items-center gap-2 font-mono text-[11px] text-neon-lime">
                  <IconCheck width={13} height={13} /> {sum.job.note}{" "}
                  <Link href="/library" className="text-neon-cyan hover:underline">view in Library →</Link>
                </p>
              )}
              {sum.job.status === "error" && sum.job.error && (
                <p className="font-mono text-[11px] text-neon-rose">Distill error: {sum.job.error}</p>
              )}
            </div>
          </Panel>

          {/* sample */}
          <Panel title="Biggest Conversations" delay={0.15} right={<span className="font-mono text-[10px] text-ink-faint">top {sum.sample.length}</span>}>
            <div className="flex flex-col divide-y divide-line p-2">
              {sum.sample.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <StatusOrb accent={c.processed ? "lime" : "amber"} pulsing={false} size={6} />
                  <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-ink-faint">{SOURCE_LABEL[c.source] ?? c.source}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-dim">{c.title}</span>
                  <span className="font-mono text-[10px] text-ink-faint">{c.messageCount} msgs</span>
                  <span className="hidden font-mono text-[10px] text-ink-faint sm:inline">{fmtDate(c.createdAt)}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : (
        sum && (
          <Panel title="No exports found yet" delay={0.05}>
            <div className="flex flex-col gap-2 p-5 text-xs leading-6 text-ink-faint">
              <p>Nothing in the exports folder yet. Once your download arrives:</p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>Unzip it (or leave the .zip — it auto-extracts on Windows).</li>
                <li>
                  Put the folder or its <span className="font-mono">conversations.json</span> into{" "}
                  <span className="font-mono text-neon-cyan">{sum.exportsDir}</span>.
                </li>
                <li>Hit <span className="text-ink">Scan exports</span> above.</li>
              </ol>
              <p>Both ChatGPT and Claude name their file <span className="font-mono">conversations.json</span> — you can drop both; they&apos;re detected automatically.</p>
            </div>
          </Panel>
        )
      )}
    </div>
  );
}
