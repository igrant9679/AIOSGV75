"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import Markdown from "./Markdown";
import StatusOrb from "./ui/StatusOrb";
import { IconRocket, IconTrash, IconCheck, IconSpark, IconStudio } from "./icons";
import { useMission } from "./store";

interface SeoCheck {
  label: string;
  pass: boolean;
  detail: string;
}
interface ContentItem {
  id: string;
  keyword: string;
  title: string;
  slug: string;
  metaDescription: string;
  secondaryKeywords: string[];
  bodyMarkdown: string;
  heroPrompt: string;
  heroImageId?: string;
  wordCount: number;
  seoScore: number;
  checks: SeoCheck[];
  status: "drafting" | "draft" | "error" | "published";
  publishedUrl?: string;
  error?: string;
  agent: string;
  createdAt: number;
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

function scoreAccent(score: number): string {
  if (score >= 80) return "var(--ac-lime)";
  if (score >= 50) return "var(--ac-amber)";
  return "var(--ac-rose)";
}

export default function ContentSection() {
  const { registry, addEvent } = useMission();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [vaultOk, setVaultOk] = useState(true);
  const [wpConfigured, setWpConfigured] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [agent, setAgent] = useState("claude");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const agentOptions = [
    { id: "claude", name: "Claude" },
    { id: "auto", name: "Auto (router)" },
    ...registry.llms.map((l) => ({ id: l.id, name: l.name })),
    ...registry.commandAgents.map((c) => ({ id: c.id, name: c.name })),
  ];

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/content");
      if (res.ok) {
        const j = (await res.json()) as { items: ContentItem[]; vaultOk: boolean };
        setItems(j.items ?? []);
        setVaultOk(j.vaultOk);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const [pub, svc] = await Promise.all([fetch("/api/publish"), fetch("/api/services")]);
      if (pub.ok) setWpConfigured(((await pub.json()) as { wordpress: { configured: boolean } }).wordpress.configured);
      if (svc.ok) {
        const services = ((await svc.json()) as { services: { id: string; categories: string[]; configured: boolean }[] }).services;
        setImageReady(services.some((s) => s.categories.includes("image") && s.configured));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadItems();
    loadStatus();
  }, [loadItems, loadStatus]);

  const drafting = items.some((x) => x.status === "drafting");
  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(loadItems, 4000);
    return () => clearInterval(t);
  }, [drafting, loadItems]);

  const draft = async () => {
    setErr("");
    const kw = keyword.trim();
    if (!kw) return;
    setBusy(true);
    try {
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft", keyword: kw, agent }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || j.error) setErr(j.error ?? "draft failed");
      else {
        addEvent("CONTENT", `Drafting “${kw.slice(0, 40)}” with ${agent}`, "violet");
        setKeyword("");
      }
      await loadItems();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: "hero" | "publish", extra?: Record<string, unknown>) => {
    setErr("");
    setActing(id + action);
    try {
      const res = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, ...extra }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; item?: ContentItem };
      if (!res.ok || j.error) {
        setErr(j.error ?? `${action} failed`);
        addEvent("CONTENT", `${action} failed: ${(j.error ?? "").slice(0, 50)}`, "rose");
      } else if (j.item) {
        addEvent("CONTENT", action === "publish" ? `Published to WordPress` : `Hero image generated`, "lime");
        setItems((xs) => xs.map((x) => (x.id === id ? j.item! : x)));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setActing(null);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/content?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setItems((xs) => xs.filter((x) => x.id !== id));
  };

  const downloadMd = (item: ContentItem) => {
    const md = `# ${item.title}\n\n${item.bodyMarkdown}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyHtml = async (item: ContentItem) => {
    try {
      const res = await fetch(`/api/content/export?id=${item.id}&format=html`);
      const html = await res.text();
      await navigator.clipboard.writeText(html);
      addEvent("CONTENT", "HTML copied to clipboard", "cyan");
    } catch {
      setErr("could not copy HTML");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!vaultOk && (
        <div role="alert" className="rounded-xl border border-neon-rose/30 bg-neon-rose/10 px-4 py-2.5 font-mono text-xs text-neon-rose">
          Vault not reachable — articles are saved into the Obsidian vault, so check VAULT_DIR.
        </div>
      )}
      {err && (
        <div role="alert" className="rounded-xl border border-neon-rose/30 bg-neon-rose/10 px-4 py-2.5 font-mono text-xs text-neon-rose">
          {err}
        </div>
      )}

      {/* brief */}
      <Panel title="New SEO Article" right={<span className="font-mono text-[10px] text-ink-faint">saved to Agentic OS/Content</span>}>
        <div className="flex flex-col gap-3 p-5">
          <div>
            <label className={labelCls} htmlFor="ct-keyword">TARGET KEYWORD / TOPIC</label>
            <input
              id="ct-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") draft();
              }}
              placeholder="best noise-cancelling headphones for travel"
              className={inputCls}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[10rem]">
              <label className={labelCls} htmlFor="ct-agent">WRITER</label>
              <select id="ct-agent" value={agent} onChange={(e) => setAgent(e.target.value)} className={`${inputCls} cursor-pointer`}>
                {agentOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={draft}
              disabled={busy || !keyword.trim()}
              className="ml-auto flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-violet-700 to-neon-violet px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              <IconRocket width={15} height={15} /> {busy ? "Starting…" : "Draft article"}
            </motion.button>
          </div>
          {!wpConfigured && (
            <p className="text-[11px] leading-4 text-ink-faint">
              Tip: connect a WordPress site in{" "}
              <Link href="/settings" className="text-neon-violet hover:underline">Settings → Publishing</Link> to push drafts
              straight to your blog. Without it, you can still export Markdown/HTML.
            </p>
          )}
        </div>
      </Panel>

      {/* list */}
      <Panel title="Articles" delay={0.05} right={<span className="font-mono text-[10px] text-ink-faint">{items.length}</span>}>
        <div className="flex flex-col gap-3 p-5">
          {items.length === 0 && <p className="py-8 text-center text-xs text-ink-faint">No articles yet — draft your first from a keyword above.</p>}
          {items.map((item) => {
            const isOpen = open === item.id;
            return (
              <div key={item.id} className="rounded-xl border border-line bg-white/[0.02]">
                {/* header row */}
                <div className="flex items-center gap-3 p-3">
                  {item.status === "drafting" ? (
                    <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }} className="text-neon-violet">
                      <IconSpark width={18} height={18} />
                    </motion.span>
                  ) : (
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
                      style={{ background: `color-mix(in srgb, ${scoreAccent(item.seoScore)} 18%, transparent)`, color: scoreAccent(item.seoScore) }}
                      title="SEO score"
                    >
                      {item.status === "error" ? "—" : item.seoScore}
                    </div>
                  )}
                  <button onClick={() => setOpen(isOpen ? null : item.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                    <p className="truncate text-sm font-semibold text-ink">
                      {item.status === "drafting" ? `Drafting “${item.keyword}”…` : item.title || item.keyword}
                    </p>
                    <p className="truncate font-mono text-[10px] text-ink-faint">
                      {item.status === "error" ? item.error : `${item.keyword} · ${item.wordCount} words · ${item.agent}`}
                    </p>
                  </button>
                  {item.status === "published" && (
                    <span className="rounded bg-neon-lime/10 px-2 py-0.5 font-mono text-[9px] tracking-wide text-neon-lime">PUBLISHED</span>
                  )}
                  {item.publishedUrl && (
                    <a href={item.publishedUrl} target="_blank" rel="noreferrer" className="cursor-pointer rounded p-1 text-ink-faint hover:text-neon-cyan" aria-label="Open on WordPress">↗</a>
                  )}
                  <button onClick={() => remove(item.id)} aria-label="Delete article" className="cursor-pointer rounded p-1 text-ink-faint transition-colors hover:text-neon-rose">
                    <IconTrash width={13} height={13} />
                  </button>
                </div>

                {/* detail */}
                {isOpen && item.status !== "drafting" && item.status !== "error" && (
                  <div className="flex flex-col gap-4 border-t border-line p-4">
                    <div>
                      <p className={labelCls}>META DESCRIPTION</p>
                      <p className="text-xs leading-5 text-ink-dim">{item.metaDescription}</p>
                    </div>
                    {item.secondaryKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.secondaryKeywords.map((k) => (
                          <span key={k} className="rounded bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] text-ink-dim">{k}</span>
                        ))}
                      </div>
                    )}

                    {/* SEO checklist */}
                    <div>
                      <p className={labelCls}>SEO CHECKLIST · {item.seoScore}/100</p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {item.checks.map((c) => (
                          <div key={c.label} className="flex items-center gap-2 text-[11px]">
                            <StatusOrb accent={c.pass ? "lime" : "rose"} pulsing={false} size={6} />
                            <span className="text-ink-dim">{c.label}</span>
                            <span className="ml-auto font-mono text-[9px] text-ink-faint">{c.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* hero */}
                    <div>
                      <p className={labelCls}>HERO IMAGE</p>
                      {item.heroImageId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/studio/media?id=${item.heroImageId}`} alt="hero" className="max-h-56 rounded-lg border border-line object-cover" />
                      ) : (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => act(item.id, "hero")}
                            disabled={!imageReady || acting === item.id + "hero"}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <IconStudio width={14} height={14} /> {acting === item.id + "hero" ? "Generating…" : "Generate hero image"}
                          </button>
                          {!imageReady && (
                            <span className="text-[11px] text-ink-faint">
                              needs an image key — <Link href="/settings" className="text-neon-cyan hover:underline">add one</Link>
                            </span>
                          )}
                        </div>
                      )}
                      {item.heroPrompt && <p className="mt-1 text-[10px] italic leading-4 text-ink-faint">{item.heroPrompt}</p>}
                    </div>

                    {/* body preview */}
                    <details className="rounded-lg border border-line bg-white/[0.01] px-3 py-2">
                      <summary className="cursor-pointer font-mono text-[10px] tracking-[0.14em] text-ink-faint">ARTICLE BODY</summary>
                      <div className="mt-2 max-h-96 overflow-y-auto pr-1">
                        <Markdown>{item.bodyMarkdown}</Markdown>
                      </div>
                    </details>

                    {/* actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => downloadMd(item)} className="cursor-pointer rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06]">↓ Markdown</button>
                      <button onClick={() => copyHtml(item)} className="cursor-pointer rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06]">⧉ Copy HTML</button>
                      {wpConfigured ? (
                        <button
                          onClick={() => act(item.id, "publish", { status: "draft" })}
                          disabled={acting === item.id + "publish"}
                          className="ml-auto flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-lime-600 to-neon-lime px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <IconCheck width={14} height={14} /> {acting === item.id + "publish" ? "Publishing…" : "Push to WordPress (draft)"}
                        </button>
                      ) : (
                        <Link href="/settings" className="ml-auto cursor-pointer rounded-lg border border-dashed border-line px-4 py-2 text-xs text-ink-faint transition-colors hover:bg-white/[0.06]">
                          🔌 Connect WordPress to publish
                        </Link>
                      )}
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
