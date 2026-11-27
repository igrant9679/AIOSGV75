"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import GlowTile from "../ui/GlowTile";
import Markdown from "../Markdown";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { GithubProgress, GithubReport, RepoReport, Waiting, WaitingKind } from "@/lib/githubReport";
import { Chip, ago } from "./common";
import { MiniBars } from "./Charts";
import { SmallButton } from "./SessionPanel";

interface View {
  report: GithubReport | null;
  progress: GithubProgress | null;
  signin: { installed: boolean; accounts: { login: string; active: boolean }[]; note?: string };
  error?: string;
}

const KIND_LABEL: Record<WaitingKind, string> = {
  "review-requested": "review requested",
  "changes-requested": "changes requested",
  "checks-failing": "checks failing",
  "ready-to-merge": "ready to merge",
  "idle-pr": "idle PR",
  "pr-to-review": "PR to review",
  assigned: "assigned",
  "awaiting-reply": "awaiting reply",
  "ci-failing": "main failing",
  security: "security",
  doc: "from a status doc",
};
const PRIORITY: Record<1 | 2 | 3, { label: string; accent: Accent }> = { 1: { label: "Do soon", accent: "rose" }, 2: { label: "This week", accent: "amber" }, 3: { label: "When you can", accent: "cyan" } };
const STATUS: Record<string, Accent> = { attention: "rose", active: "lime", quiet: "cyan" };
const ts = (iso?: string) => (iso ? Date.parse(iso) : 0);
const fmt = (n: number) => n.toLocaleString();

/**
 * /github: every repository on the owner's GitHub accounts, what happened in them, what is waiting
 * on the owner, and reports in plain language (lib/githubReport.ts).
 */
export default function GithubSection() {
  const [view, setView] = useState<View | null>(null);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/github")
      .then((r) => r.json())
      .then((b: View) => {
        setView(b);
        if (b.report?.days) setDays((d) => (b.progress?.running ? d : b.report!.days));
      })
      .catch((e: Error) => setErr(e.message));
  }, []);
  const running = !!view?.progress?.running;
  useEffect(() => {
    load();
    const t = setInterval(load, running ? 2_500 : 60_000);
    return () => clearInterval(t);
  }, [load, running]);

  const refresh = async (d = days) => {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/github", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh", days: d }) })
      .then((x) => x.json())
      .catch((e: Error) => ({ error: e.message }));
    setBusy(false);
    if (r.error) setErr(r.error);
    load();
  };

  const rep = view?.report ?? null;
  const signedIn = (view?.signin.accounts.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="GitHub" right={rep ? <span className="font-mono text-[10px] text-ink-faint">updated {ago(ts(rep.generatedAt))} ago · last {rep.days} days</span> : undefined}>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
            <span className="text-ink-faint">Accounts:</span>
            {view?.signin.accounts.map((a) => (
              <span key={a.login} className="rounded-md border px-2 py-0.5" style={{ borderColor: ACCENTS.lime.border, color: ACCENTS.lime.base }}>
                ✓ {a.login}
                {rep?.accounts.find((x) => x.login === a.login)?.repos !== undefined ? ` · ${rep?.accounts.find((x) => x.login === a.login)?.repos} repos` : ""}
              </span>
            ))}
            {view && !signedIn && <span style={{ color: ACCENTS.amber.base }}>not signed in: public repositories only</span>}
            <span className="flex-1" />
            <span className="text-ink-faint">Period:</span>
            {[7, 14, 30].map((d) => (
              <Chip key={d} active={days === d} onClick={() => setDays(d)}>
                {d} days
              </Chip>
            ))}
            <SmallButton accent onClick={() => void refresh()} disabled={busy || running} title="Collect everything again and write new reports (a few minutes)">
              {running ? "Working…" : busy ? "Starting…" : rep && rep.days !== days ? `Refresh for ${days} days` : "Refresh"}
            </SmallButton>
          </div>
          {running && view?.progress && <ProgressBar p={view.progress} />}
          {!running && view?.progress?.error && (
            <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
              The last refresh didn&apos;t finish: {view.progress.error}
            </p>
          )}
          {err && (
            <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
              {err}
            </p>
          )}
          {view && !signedIn && (
            <div className="rounded-lg border px-3 py-2 text-[11px] leading-5" style={{ borderColor: ACCENTS.amber.border }}>
              <p className="font-semibold text-ink">Sign the GitHub CLI in to both accounts to see private repositories and everything in them.</p>
              <p className="text-ink-dim">
                In a <b>normal PowerShell window</b> (from the Start menu, not a terminal inside the Claude app) run <code>gh auth login --hostname github.com --git-protocol https --web</code>, choose HTTPS and the browser, and approve. Then run it again signed in to the browser as the other account. Mission Control asks the GitHub CLI for each account&apos;s sign-in when it collects; it never stores or shows a token.
              </p>
            </div>
          )}
          {!rep && view && !running && <p className="text-[11px] text-ink-faint">No report yet. Press Refresh to make the first one{signedIn ? "" : " (public repositories only until you sign in)"}.</p>}
          {rep && (
            <p className="text-[10px] leading-4 text-ink-faint">
              {rep.repos.length} repositories · collected in {Math.round(rep.tookMs / 1000)}s · reports written by Claude with no tools (it only reads the data shown here) · stored on this machine only
              {rep.errors.length ? ` · ${rep.errors.length} problem${rep.errors.length === 1 ? "" : "s"} (see the end of the page)` : ""}
            </p>
          )}
        </div>
      </Panel>

      {rep && <Report rep={rep} />}
    </div>
  );
}

function ProgressBar({ p }: { p: GithubProgress }) {
  const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-all" style={{ width: `${p.total ? pct : 15}%`, background: ACCENTS.cyan.base }} />
      </div>
      <p className="font-mono text-[10px]" style={{ color: ACCENTS.cyan.base }}>
        {p.step} · {ago(p.startedAt)}
      </p>
    </div>
  );
}

function Report({ rep }: { rep: GithubReport }) {
  const allWaiting = useMemo(() => {
    const list: (Waiting & { repo: string })[] = [];
    for (const r of rep.repos) for (const w of r.waiting) list.push({ ...w, repo: r.id });
    for (const w of rep.elsewhere) list.push({ ...w, repo: "elsewhere" });
    return list.sort((a, b) => a.priority - b.priority || ts(b.since) - ts(a.since));
  }, [rep]);
  const active = rep.repos.filter((r) => r.commits.total > 0 || (r.activityCount ?? 0) > 0);
  // without a sign-in the repositories' own figures are unknown, not zero
  const unknown = rep.anonymous;
  const num = (n: number) => (unknown ? "—" : fmt(n));
  const commits = rep.repos.reduce((n, r) => n + r.commits.total, 0);
  const merged = rep.repos.reduce((n, r) => n + r.prs.merged.length, 0);
  const closedIssues = rep.repos.reduce((n, r) => n + r.issues.closed.length, 0);
  const releases = rep.repos.reduce((n, r) => n + r.releases.length, 0);
  const urgent = allWaiting.filter((w) => w.priority === 1).length;
  // commits per day across every repository, oldest first
  const daily = useMemo(() => {
    const n = Math.min(rep.days, 30);
    const out = new Array(n).fill(0);
    const today = new Date();
    for (const r of rep.repos)
      for (const [day, c] of Object.entries(r.commits.perDay)) {
        const diff = Math.floor((Date.parse(today.toISOString().slice(0, 10)) - Date.parse(day)) / 86_400_000);
        if (diff >= 0 && diff < n) out[n - 1 - diff] += c;
      }
    return out;
  }, [rep]);

  return (
    <>
      {rep.overall ? (
        <Panel title="This period in your repositories">
          <div className="flex flex-col gap-3 p-5">
            <p className="text-lg font-semibold leading-7 text-ink">{rep.overall.headline}</p>
            <div className="text-sm leading-6 text-ink-dim">
              <Markdown>{rep.overall.narrative}</Markdown>
            </div>
            {rep.overall.priorities.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="panel-title">Priorities</p>
                <ol className="flex flex-col gap-1.5">
                  {rep.overall.priorities.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-5">
                      <span className="font-mono text-[11px] text-ink-faint">{i + 1}.</span>
                      <span>
                        <span className="font-mono text-[11px]" style={{ color: ACCENTS.violet.base }}>
                          {p.repo}
                        </span>{" "}
                        <b className="text-ink">{p.action}</b> <span className="text-ink-dim">— {p.why}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {rep.overall.quiet && <p className="text-[12px] italic text-ink-faint">{rep.overall.quiet}</p>}
            <p className="font-mono text-[9px] text-ink-faint">written by {rep.overall.model} from the per-repository reports</p>
          </div>
        </Panel>
      ) : rep.overallError ? (
        <p className="text-[11px]" style={{ color: ACCENTS.amber.base }}>
          The overview couldn&apos;t be written: {rep.overallError}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <GlowTile accent="violet" label="Repositories" value={`${active.length}/${rep.repos.length}`}>
          <span className="font-mono text-[10px] text-ink-faint">active / total</span>
        </GlowTile>
        <GlowTile accent="lime" label={`Commits · ${rep.days}d`} value={num(commits)}>
          <MiniBars values={daily} color={ACCENTS.lime.base} label="Commits per day across every repository (today on the right)" />
        </GlowTile>
        <GlowTile accent="cyan" label="PRs merged" value={num(merged)} />
        <GlowTile accent="magenta" label="Issues closed" value={num(closedIssues)} />
        <GlowTile accent="amber" label="Releases" value={num(releases)} />
        <GlowTile accent="rose" label="Waiting on you" value={num(allWaiting.length)}>
          <span className="font-mono text-[10px]" style={{ color: urgent ? ACCENTS.rose.base : undefined }}>
            {urgent} to do soon
          </span>
        </GlowTile>
      </div>

      <WaitingPanel items={allWaiting} />
      <RepoGrid rep={rep} />
      <ActivityPanel rep={rep} />

      {rep.errors.length > 0 && (
        <Panel title="Problems while collecting">
          <ul className="flex flex-col gap-1 p-4 font-mono text-[10px] text-ink-dim">
            {rep.errors.slice(0, 40).map((e, i) => (
              <li key={i}>· {e}</li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function WaitingPanel({ items }: { items: (Waiting & { repo: string })[] }) {
  const [kind, setKind] = useState<string>("");
  const [more, setMore] = useState(false);
  const kinds = [...new Set(items.map((w) => w.kind))];
  const shown = items.filter((w) => !kind || w.kind === kind);
  return (
    <Panel title="Waiting on you" right={<span className="font-mono text-[10px] text-ink-faint">{items.length} items across every repository</span>}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[11px] leading-4 text-ink-faint">
          From GitHub itself (reviews asked of you, your pull requests that need something, issues assigned to you or waiting for your reply, failing checks, security alerts) and from the “waiting on you”, “for you to do” and “next steps” sections of each repository&apos;s status documents.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={!kind} onClick={() => setKind("")}>
            all
          </Chip>
          {kinds.map((k) => (
            <Chip key={k} active={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]} ({items.filter((w) => w.kind === k).length})
            </Chip>
          ))}
        </div>
        {shown.length === 0 && <p className="text-[12px] text-ink-faint">Nothing waiting on you.</p>}
        {([1, 2, 3] as const).map((p) => {
          const group = shown.filter((w) => w.priority === p);
          if (!group.length) return null;
          const list = more ? group : group.slice(0, p === 1 ? 50 : 12);
          return (
            <div key={p} className="flex flex-col gap-1">
              <p className="font-mono text-[10px] font-semibold" style={{ color: ACCENTS[PRIORITY[p].accent].base }}>
                {PRIORITY[p].label} · {group.length}
              </p>
              {list.map((w, i) => (
                <div key={`${w.repo}-${i}`} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-1.5">
                  <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ACCENTS[PRIORITY[p].accent].base }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-5 text-ink">
                      {w.url ? (
                        <a href={w.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {w.title}
                        </a>
                      ) : (
                        w.title
                      )}
                    </p>
                    <p className="font-mono text-[10px] text-ink-faint">
                      <span style={{ color: ACCENTS.violet.base }}>{w.repo}</span> · {KIND_LABEL[w.kind]}
                      {w.detail ? ` · ${w.detail}` : ""}
                      {w.since ? ` · ${ago(ts(w.since))} ago` : ""}
                    </p>
                  </div>
                </div>
              ))}
              {!more && group.length > list.length && (
                <button type="button" onClick={() => setMore(true)} className="cursor-pointer self-start font-mono text-[10px] text-ink-faint underline">
                  show all {group.length}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

type RepoFilter = "all" | "attention" | "active" | "quiet" | "private" | "archived";

function RepoGrid({ rep }: { rep: GithubReport }) {
  const [filter, setFilter] = useState<RepoFilter>("all");
  const [q, setQ] = useState("");
  const status = (r: RepoReport) => r.summary?.status ?? (r.waiting.some((w) => w.priority === 1) ? "attention" : r.commits.total || r.activityCount ? "active" : "quiet");
  const list = rep.repos.filter((r) => {
    if (q && !`${r.id} ${r.description ?? ""} ${r.language ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "private") return r.private;
    if (filter === "archived") return r.archived;
    if (filter !== "all") return status(r) === filter && !r.archived;
    return true;
  });
  const count = (f: RepoFilter) => rep.repos.filter((r) => (f === "private" ? r.private : f === "archived" ? r.archived : f === "all" ? true : status(r) === f && !r.archived)).length;
  return (
    <Panel title="Repositories" right={<span className="font-mono text-[10px] text-ink-faint">{list.length} shown</span>}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["all", "attention", "active", "quiet", "private", "archived"] as RepoFilter[]).map((f) => (
            <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
              {f} ({count(f)})
            </Chip>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a repository" aria-label="Find a repository" className="ml-auto rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[10px] text-ink outline-none" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((r) => (
            <RepoCard key={r.id} r={r} days={rep.days} status={status(r)} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Badge({ children, accent }: { children: string; accent?: Accent }) {
  return (
    <span className="rounded border px-1 font-mono text-[9px]" style={accent ? { borderColor: ACCENTS[accent].border, color: ACCENTS[accent].base } : { borderColor: "var(--color-line)", color: "var(--color-ink-faint)" }}>
      {children}
    </span>
  );
}

function RepoCard({ r, days, status }: { r: RepoReport; days: number; status: string }) {
  const [open, setOpen] = useState(false);
  const ciAccent: Accent | undefined = r.ci === "SUCCESS" ? "lime" : r.ci === "FAILURE" || r.ci === "ERROR" ? "rose" : r.ci ? "amber" : undefined;
  const waitingText = r.summary?.waiting.length ? r.summary.waiting : r.waiting.map((w) => w.title);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3" style={{ borderLeft: `3px solid ${ACCENTS[STATUS[status] ?? "cyan"].base}` }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <a href={r.url} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-ink hover:underline">
          {r.id}
        </a>
        <Badge accent={STATUS[status]}>{status}</Badge>
        {r.private && <Badge>private</Badge>}
        {r.fork && <Badge>fork</Badge>}
        {r.archived && <Badge>archived</Badge>}
        {r.relation !== "owner" && <Badge>{r.relation}</Badge>}
        {r.language && <span className="font-mono text-[10px] text-ink-faint">{r.language}</span>}
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-ink-faint">{r.pushedAt ? `pushed ${ago(ts(r.pushedAt))} ago` : ""}</span>
      </div>
      {r.description && <p className="text-[11px] text-ink-faint">{r.description}</p>}
      {r.summary ? (
        <p className="text-[12.5px] leading-5 text-ink">{r.summary.week}</p>
      ) : (
        <p className="text-[12px] italic text-ink-faint">{r.commits.total ? `${r.commits.total} commits in the last ${days} days.` : r.activityCount ? `${r.activityCount} of your GitHub events here in the last ${days} days${r.errors.length ? " (sign in for its details)" : ""}.` : `No changes in the last ${days} days.`}{r.summaryError ? ` (No written report: ${r.summaryError})` : ""}</p>
      )}
      {waitingText.length > 0 && (
        <div className="rounded-lg px-2.5 py-1.5" style={{ background: "color-mix(in srgb, var(--ac-rose) 7%, transparent)" }}>
          <p className="font-mono text-[10px] font-semibold" style={{ color: ACCENTS.rose.base }}>
            Waiting on you
          </p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {waitingText.slice(0, 6).map((w, i) => (
              <li key={i} className="text-[11.5px] leading-4 text-ink-dim">
                · {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.summary?.health && <p className="text-[11px] text-ink-faint">{r.summary.health}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-ink-dim">
        <span>
          <b className="text-ink">{r.commits.total}</b> commits{r.commits.total ? ` (+${fmt(r.commits.additions)} / −${fmt(r.commits.deletions)})` : ""}
        </span>
        <span>
          <b className="text-ink">{r.prs.merged.length}</b> merged · {r.prs.openCount} open PRs
        </span>
        <span>
          {r.issues.openCount} open issues{r.issues.closed.length ? ` · ${r.issues.closed.length} closed` : ""}
        </span>
        {r.releases.length > 0 && <span>{r.releases.length} release{r.releases.length === 1 ? "" : "s"}</span>}
        {r.ci && <span style={{ color: ciAccent ? ACCENTS[ciAccent].base : undefined }}>checks: {r.ci.toLowerCase()}</span>}
        {r.alerts?.count ? <span style={{ color: ACCENTS.rose.base }}>{r.alerts.count} security alerts</span> : null}
        {r.docs.length > 0 && <span>{r.docs.length} status doc{r.docs.length === 1 ? "" : "s"}</span>}
        {r.activityCount ? <span>your activity: {r.activityCount} events</span> : null}
        <span className="flex-1" />
        <button type="button" onClick={() => setOpen(!open)} className="cursor-pointer underline">
          {open ? "less" : "details"}
        </button>
      </div>
      {open && <RepoDetails r={r} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="panel-title">{title}</p>
      {children}
    </div>
  );
}

function Line({ href, text, meta }: { href?: string; text: string; meta?: string }) {
  return (
    <p className="truncate text-[11px] text-ink-dim">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
          {text}
        </a>
      ) : (
        text
      )}
      {meta && <span className="font-mono text-[10px] text-ink-faint"> · {meta}</span>}
    </p>
  );
}

function RepoDetails({ r }: { r: RepoReport }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-2">
      {Object.keys(r.commits.byAuthor).length > 0 && (
        <p className="font-mono text-[10px] text-ink-faint">
          by{" "}
          {Object.entries(r.commits.byAuthor)
            .sort((a, b) => b[1] - a[1])
            .map(([a, n]) => `${a} (${n})`)
            .join(", ")}
        </p>
      )}
      {r.commits.items.length > 0 && (
        <Section title={`Commits (${r.commits.total})`}>
          {r.commits.items.slice(0, 25).map((c) => (
            <Line key={c.sha} href={c.url} text={c.message} meta={`${c.sha} · ${c.author} · ${c.date.slice(0, 10)}`} />
          ))}
          {r.commits.total > 25 && <p className="font-mono text-[10px] text-ink-faint">+ {r.commits.total - 25} more</p>}
        </Section>
      )}
      {(r.prs.open.length > 0 || r.prs.merged.length > 0) && (
        <Section title="Pull requests">
          {r.prs.merged.map((p) => (
            <Line key={`m${p.number}`} href={p.url} text={`merged #${p.number} ${p.title}`} meta={`${p.author} · ${p.at.slice(0, 10)}`} />
          ))}
          {r.prs.open.map((p) => (
            <Line key={`o${p.number}`} href={p.url} text={`open #${p.number} ${p.title}`} meta={[p.author, p.draft ? "draft" : "", p.review?.toLowerCase().replace("_", " ") ?? "", p.checks ? `checks ${p.checks.toLowerCase()}` : "", `updated ${ago(ts(p.updatedAt))} ago`].filter(Boolean).join(" · ")} />
          ))}
        </Section>
      )}
      {(r.issues.open.length > 0 || r.issues.closed.length > 0) && (
        <Section title={`Issues (${r.issues.openCount} open)`}>
          {r.issues.closed.map((i) => (
            <Line key={`c${i.number}`} href={i.url} text={`closed #${i.number} ${i.title}`} meta={i.at.slice(0, 10)} />
          ))}
          {r.issues.open.slice(0, 15).map((i) => (
            <Line key={`i${i.number}`} href={i.url} text={`#${i.number} ${i.title}`} meta={[i.author, i.labels.join(", "), i.assignees.length ? `assigned ${i.assignees.join(", ")}` : "", `updated ${ago(ts(i.updatedAt))} ago`].filter(Boolean).join(" · ")} />
          ))}
        </Section>
      )}
      {r.releases.length > 0 && (
        <Section title="Releases">
          {r.releases.map((x) => (
            <Line key={x.tag} href={x.url} text={x.name} meta={x.at.slice(0, 10)} />
          ))}
        </Section>
      )}
      {r.docs.length > 0 && (
        <Section title="Status documents">
          {r.docs.map((d) => (
            <div key={d.path} className="flex flex-col gap-0.5">
              <Line href={d.url} text={d.path} meta={d.error ? `couldn't read: ${d.error}` : `${d.updatedAt ? `updated ${d.updatedAt.slice(0, 10)}` : ""}${d.waiting.length ? ` · ${d.waiting.length} waiting items` : ""}`} />
              {d.waiting.slice(0, 8).map((w, i) => (
                <p key={i} className="pl-3 text-[11px] text-ink-faint">
                  · {w.text}
                </p>
              ))}
            </div>
          ))}
        </Section>
      )}
      {r.branches.total > 1 && (
        <Section title={`Branches (${r.branches.total})`}>
          <p className="font-mono text-[10px] text-ink-faint">{r.branches.recent.map((b) => `${b.name}${b.at ? ` (${b.at.slice(0, 10)})` : ""}`).join(" · ")}</p>
        </Section>
      )}
      {r.alerts?.items.length ? (
        <Section title="Security alerts">
          {r.alerts.items.map((a, i) => (
            <p key={i} className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
              · {a}
            </p>
          ))}
        </Section>
      ) : null}
      {r.errors.length > 0 && <p className="font-mono text-[10px]" style={{ color: ACCENTS.amber.base }}>{r.errors.join(" · ")}</p>}
    </div>
  );
}

function ActivityPanel({ rep }: { rep: GithubReport }) {
  const [acct, setAcct] = useState("");
  const [more, setMore] = useState(false);
  const accounts = [...new Set(rep.activity.map((a) => a.account))];
  const list = rep.activity.filter((a) => !acct || a.account === acct);
  const byType = list.reduce<Record<string, number>>((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {});
  return (
    <Panel title="Your activity" right={<span className="font-mono text-[10px] text-ink-faint">{list.length} events in {rep.days} days</span>}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!acct} onClick={() => setAcct("")}>
            both accounts
          </Chip>
          {accounts.map((a) => (
            <Chip key={a} active={acct === a} onClick={() => setAcct(a)}>
              {a}
            </Chip>
          ))}
          <span className="font-mono text-[10px] text-ink-faint">
            {Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => `${t} ${n}`)
              .join(" · ")}
          </span>
        </div>
        {list.length === 0 && <p className="text-[12px] text-ink-faint">No activity recorded by GitHub in this period.</p>}
        <div className="flex flex-col">
          {(more ? list : list.slice(0, 40)).map((a, i) => (
            <div key={i} className="flex items-baseline gap-3 border-b border-line py-1 last:border-b-0">
              <span className="w-12 shrink-0 font-mono text-[10px] text-ink-faint">{ago(ts(a.at))}</span>
              <span className="w-44 shrink-0 truncate font-mono text-[10px]" style={{ color: ACCENTS.violet.base }}>
                {a.repo}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-dim">
                {accounts.length > 1 && <span className="font-mono text-[10px] text-ink-faint">{a.account} </span>}
                {a.text}
              </span>
            </div>
          ))}
        </div>
        {!more && list.length > 40 && (
          <button type="button" onClick={() => setMore(true)} className="cursor-pointer self-start font-mono text-[10px] text-ink-faint underline">
            show all {list.length}
          </button>
        )}
      </div>
    </Panel>
  );
}
