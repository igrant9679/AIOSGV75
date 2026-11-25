"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import Markdown from "./Markdown";
import { brandText, useProductName } from "./useNetSettings";
import { metaForPath } from "@/lib/accents";
import { GUIDE_SECTIONS } from "@/lib/guideContent";
import { GLOSSARY, HELP_INTRO, HOW_TO, START_HERE, WHICH_PAGE, helpForPath } from "@/lib/helpContent";

/**
 * The Help panel: a side drawer on every page. Opened by the Help button in the
 * header, F1, or `openHelp()` from anywhere. Five tabs:
 *   This page  · what the current page is for and how to use it
 *   Start here · the orientation, and which page to use for what
 *   How do I…  · searchable answers (also searches the glossary and the Guide)
 *   Glossary   · the app's words in plain language
 *   Ask        · a question in your own words, answered from the manual
 * Content: lib/helpContent.ts. Full reference: /guide.
 */

type Tab = "page" | "start" | "howto" | "glossary" | "ask";
const TABS: [Tab, string][] = [
  ["page", "This page"],
  ["start", "Start here"],
  ["howto", "How do I…"],
  ["glossary", "Glossary"],
  ["ask", "Ask"],
];

const OPEN_EVENT = "mc-help-open";
/** Open the Help panel from anywhere, optionally on a tab. */
export function openHelp(tab?: Tab): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { tab } }));
}

const WELCOME_KEY = "mc-help-welcomed";

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

const guideTitle = (id: string) => GUIDE_SECTIONS.find((s) => s.id === id)?.title ?? id;

export default function HelpDrawer() {
  const pathname = usePathname();
  const product = useProductName();
  const b = (t: string) => brandText(t, product);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("page");
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const t = (e as CustomEvent<{ tab?: Tab }>).detail?.tab;
      setTab(t ?? (helpForPath(window.location.pathname) ? "page" : "start"));
      setOpen(true);
      setWelcome(false);
      try {
        localStorage.setItem(WELCOME_KEY, "1");
      } catch {
        /* storage blocked */
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        if (open) setOpen(false);
        else openHelp();
      } else if (e.key === "Escape" && open && !isTyping(e.target)) setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // first visit in this browser: a small pointer to Help, once
  useEffect(() => {
    try {
      if (!localStorage.getItem(WELCOME_KEY)) setWelcome(true);
    } catch {
      /* storage blocked: no welcome */
    }
  }, []);
  const dismissWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch {
      /* storage blocked */
    }
  };

  // follow navigation: links inside the panel close it
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const close = () => setOpen(false); // a manual link while already on /guide changes only the #section
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  return (
    <>
      <AnimatePresence>
        {welcome && !open && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="fixed right-4 bottom-4 z-[70] max-w-[340px]"
            role="status"
          >
            {/* .panel sets position: relative, so the positioning lives on this wrapper */}
            <div className="panel flex flex-col gap-2 p-4">
            <p className="text-sm font-semibold text-ink">New to {product}?</p>
            <p className="text-[12px] leading-5 text-ink-dim">
              Press <b>Help</b> at the top right (or <kbd className="rounded border border-line px-1 font-mono text-[11px]">F1</kbd>) any time: what the page you are on does, a
              two-minute tour, and answers to &ldquo;how do I…&rdquo;.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => openHelp("start")} className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--page-accent)" }}>
                Show me around
              </button>
              <button type="button" onClick={dismissWelcome} className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim hover:text-ink">
                Not now
              </button>
            </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[85] bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-label="Help"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-0 right-0 h-dvh w-[min(600px,100vw)]"
              style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
            >
              <div className="panel flex h-full flex-col overflow-hidden" style={{ borderRadius: 0 }}>
              <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
                <div className="min-w-0">
                  <h2 className="panel-title">Help</h2>
                  <p className="truncate text-[11px] text-ink-faint">You are on: {metaForPath(pathname).title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/guide" className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-dim hover:text-ink">
                    Full manual
                  </Link>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-dim hover:text-ink">
                    Close ✕
                  </button>
                </div>
              </header>

              <nav className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" aria-label="Help sections">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    aria-pressed={tab === id}
                    className="shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-[12px] transition-colors"
                    style={tab === id ? { background: "color-mix(in srgb, var(--page-accent) 16%, transparent)", color: "var(--page-accent)", fontWeight: 600 } : { color: "var(--color-ink-dim)" }}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              {/* the app's base styles strip list markers; answers and steps need their numbers back */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-6 text-ink-dim [&_.md-body_ol]:list-decimal [&_.md-body_ol]:pl-5 [&_.md-body_ul]:list-disc [&_.md-body_ul]:pl-5 [&_.md-body_li]:my-0.5">
                {tab === "page" && <PageTab pathname={pathname} b={b} onTab={setTab} />}
                {tab === "start" && <StartTab b={b} />}
                {tab === "howto" && <HowToTab b={b} />}
                {tab === "glossary" && <GlossaryTab b={b} />}
                {tab === "ask" && <AskTab pathname={pathname} />}
              </div>

              <footer className="border-t border-line px-5 py-2 text-[11px] text-ink-faint">
                <kbd className="font-mono">F1</kbd> opens Help · <kbd className="font-mono">Ctrl+K</kbd> jumps to any page · <kbd className="font-mono">?</kbd> keyboard shortcuts · <kbd className="font-mono">Esc</kbd> closes
              </footer>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── pieces ───

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink uppercase">{children}</h3>;
}

function GuideLinks({ ids, b }: { ids?: string[]; b: (t: string) => string }) {
  if (!ids?.length) return null;
  return (
    <>
      <H>More detail in the manual</H>
      <ul className="flex flex-col gap-1">
        {ids.map((id) => (
          <li key={id}>
            <Link href={`/guide#guide-${id}`} className="underline decoration-dotted underline-offset-2 hover:text-ink" style={{ color: "var(--page-accent)" }}>
              {b(guideTitle(id))} →
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function PageTab({ pathname, b, onTab }: { pathname: string; b: (t: string) => string; onTab: (t: Tab) => void }) {
  const h = helpForPath(pathname);
  const title = metaForPath(pathname).title;
  if (!h) {
    return (
      <div className="flex flex-col gap-3">
        <p>There&apos;s no page-specific help for {title} yet.</p>
        <button type="button" onClick={() => onTab("start")} className="self-start cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] hover:text-ink">
          Start here →
        </button>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[15px] leading-6 font-medium text-ink">{b(h.what)}</p>
      <H>Use it for</H>
      <ul className="list-disc space-y-1 pl-5">
        {h.useFor.map((u) => (
          <li key={u}>{b(u)}</li>
        ))}
      </ul>
      {h.steps?.map((s) => (
        <div key={s.title}>
          <H>{b(s.title)}</H>
          <ol className="list-decimal space-y-1.5 pl-5">
            {s.items.map((i) => (
              <li key={i}>
                <Markdown>{b(i)}</Markdown>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {h.tips?.length ? (
        <>
          <H>Good to know</H>
          <ul className="list-disc space-y-1 pl-5">
            {h.tips.map((t) => (
              <li key={t}>
                <Markdown>{b(t)}</Markdown>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <GuideLinks ids={h.guide} b={b} />
      <p className="mt-6 text-[12px] text-ink-faint">
        Still stuck?{" "}
        <button type="button" onClick={() => onTab("ask")} className="cursor-pointer underline" style={{ color: "var(--page-accent)" }}>
          Ask a question in your own words
        </button>
        .
      </p>
    </div>
  );
}

function StartTab({ b }: { b: (t: string) => string }) {
  return (
    <div>
      <Markdown>{b(HELP_INTRO)}</Markdown>
      <H>The six things worth learning first</H>
      <div className="flex flex-col gap-2.5">
        {START_HERE.map((s) => (
          <div key={s.title} className="rounded-xl border border-line px-4 py-3">
            <p className="font-semibold text-ink">{s.title}</p>
            <div className="text-[12.5px]">
              <Markdown>{b(s.body)}</Markdown>
            </div>
            <Link href={s.href} className="mt-1 inline-block rounded-lg px-3 py-1 text-[12px] font-semibold text-white" style={{ background: "var(--page-accent)" }}>
              {s.cta} →
            </Link>
          </div>
        ))}
      </div>
      <H>Which page do I use?</H>
      <p className="mb-2 text-[12px]">Several pages can &ldquo;get AIs to do something&rdquo;. This is how they differ:</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-ink">
              <th className="border-b border-line py-1.5 pr-3 font-semibold">I want to…</th>
              <th className="border-b border-line py-1.5 font-semibold">Use</th>
            </tr>
          </thead>
          <tbody>
            {WHICH_PAGE.map((w) => (
              <tr key={w.want} className="align-top">
                <td className="border-b border-line py-1.5 pr-3">{b(w.want)}</td>
                <td className="border-b border-line py-1.5">
                  <Link href={w.href} className="font-semibold underline decoration-dotted underline-offset-2" style={{ color: "var(--page-accent)" }}>
                    {w.page}
                  </Link>
                  <div className="text-[11.5px] text-ink-faint">{b(w.why)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <H>How the sidebar is organised</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <b>Agents</b> (top): Overview, Auto and a chat page per AI.
        </li>
        <li>
          <b>Second brain</b>: Command, Timeline, Projects, Fleet, Board and Runs — everything your AIs do, on every computer.
        </li>
        <li>
          <b>Workspace</b>: the tools — Missions, Tasks, Schedule, Memory, Journal, Studio, Content, reports and Settings. You can ignore most of them until you need them.
        </li>
      </ul>
    </div>
  );
}

function HowToTab({ b }: { b: (t: string) => string }) {
  const [q, setQ] = useState("");
  const [openQ, setOpenQ] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const match = (text: string) => words.every((w) => text.toLowerCase().includes(w));
  const items = useMemo(() => (words.length ? HOW_TO.filter((h) => match(`${h.q} ${h.a}`)) : HOW_TO), [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const terms = words.length ? GLOSSARY.filter((g) => match(`${g.term} ${g.def}`)).slice(0, 4) : [];
  const guide = words.length ? GUIDE_SECTIONS.filter((s) => match(`${s.title} ${s.keywords}`)).slice(0, 5) : [];
  return (
    <div className="flex flex-col gap-3">
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Type what you want to do, e.g. schedule, approve, phone…"
        aria-label="Search help"
        className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus:border-line-bright"
      />
      <ul className="flex flex-col gap-1.5">
        {items.map((h) => {
          const isOpen = openQ === h.q || (words.length > 0 && items.length <= 3);
          return (
            <li key={h.q} className="rounded-xl border border-line">
              <button type="button" onClick={() => setOpenQ(isOpen ? null : h.q)} aria-expanded={isOpen} className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2 text-left font-medium text-ink">
                <span>{b(h.q)}</span>
                <span className="text-ink-faint">{isOpen ? "–" : "+"}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3 text-[12.5px]">
                  <Markdown>{b(h.a)}</Markdown>
                  <div className="mt-1 flex flex-wrap gap-3 text-[12px]">
                    {h.href && (
                      <Link href={h.href} className="font-semibold" style={{ color: "var(--page-accent)" }}>
                        Go there →
                      </Link>
                    )}
                    {h.guide && (
                      <Link href={`/guide#guide-${h.guide}`} className="text-ink-faint underline decoration-dotted underline-offset-2">
                        Details in the manual
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {words.length > 0 && items.length === 0 && <p className="text-[12px]">No ready answer for that. Try other words, look below, or use the Ask tab.</p>}
      {terms.length > 0 && (
        <>
          <H>Terms</H>
          {terms.map((g) => (
            <p key={g.term} className="text-[12.5px]">
              <b className="text-ink">{g.term}</b> — {b(g.def)}
            </p>
          ))}
        </>
      )}
      {guide.length > 0 && (
        <>
          <H>In the manual</H>
          <ul className="flex flex-col gap-1">
            {guide.map((s) => (
              <li key={s.id}>
                <Link href={`/guide#guide-${s.id}`} className="underline decoration-dotted underline-offset-2" style={{ color: "var(--page-accent)" }}>
                  {b(s.title)} →
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GlossaryTab({ b }: { b: (t: string) => string }) {
  return (
    <dl className="flex flex-col gap-3">
      {GLOSSARY.map((g) => (
        <div key={g.term}>
          <dt className="font-semibold text-ink">{g.term}</dt>
          <dd className="text-[12.5px]">{b(g.def)}</dd>
        </div>
      ))}
    </dl>
  );
}

function AskTab({ pathname }: { pathname: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ question: string; answer?: string; error?: string; sections?: { id: string; title: string }[] } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const ask = async () => {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setBusy(true);
    setRes({ question });
    try {
      const r = await fetch("/api/help/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, path: pathname }) });
      const j = await r.json();
      setRes({ question, answer: j.answer, error: j.error, sections: j.sections });
    } catch (e) {
      setRes({ question, error: (e as Error).message });
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px]">Ask anything about how to use the app, in your own words. Claude answers from the manual (it uses a little of your Claude plan, and takes a few seconds).</p>
      <textarea
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void ask();
          }
        }}
        rows={3}
        placeholder="e.g. How do I get a report emailed to my phone every Monday?"
        aria-label="Your question"
        className="w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none focus:border-line-bright"
      />
      <button
        type="button"
        onClick={() => void ask()}
        disabled={busy || q.trim().length < 3}
        className="self-start cursor-pointer rounded-lg px-4 py-1.5 text-[12px] font-semibold text-white disabled:cursor-default disabled:opacity-50"
        style={{ background: "var(--page-accent)" }}
      >
        {busy ? "Looking it up…" : "Ask"}
      </button>
      {res && (
        <div className="rounded-xl border border-line px-4 py-3">
          <p className="mb-1 text-[11px] text-ink-faint">You asked: {res.question}</p>
          {busy && <p className="text-[12.5px]">Reading the manual…</p>}
          {res.answer && (
            <div className="text-[13px]">
              <Markdown>{res.answer}</Markdown>
            </div>
          )}
          {res.error && <p className="text-[12.5px]" style={{ color: "var(--ac-amber)" }}>{res.error}</p>}
          {res.sections?.length ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
              <span className="text-ink-faint">From:</span>
              {res.sections.map((s) => (
                <Link key={s.id} href={`/guide#guide-${s.id}`} className="underline decoration-dotted underline-offset-2" style={{ color: "var(--page-accent)" }}>
                  {s.title}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
