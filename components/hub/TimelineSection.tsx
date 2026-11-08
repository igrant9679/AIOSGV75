"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import type { ActivitySource } from "@/lib/activity";
import { useHub, SourcePill, StatusDot, HubError, IndexingNote, Chip, SOURCE_META, ago, clockTime, dayLabel } from "./common";

/** Timeline — one stream of every AI action, filterable by tool, machine and project. */
export default function TimelineSection() {
  const { hub, error } = useHub();
  const [q, setQ] = useState("");
  const [source, setSource] = useState<ActivitySource | "all">("all");
  const [host, setHost] = useState("all");
  const [project, setProject] = useState("all");

  const facets = useMemo(() => {
    const sources = new Set<ActivitySource>();
    const hosts = new Set<string>();
    const projects = new Map<string, number>();
    for (const i of hub?.items ?? []) {
      sources.add(i.source);
      hosts.add(i.host);
      if (i.project) projects.set(i.project, (projects.get(i.project) ?? 0) + 1);
    }
    return {
      sources: [...sources],
      hosts: [...hosts].sort(),
      projects: [...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p),
    };
  }, [hub]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (hub?.items ?? []).filter(
      (i) =>
        (source === "all" || i.source === source) &&
        (host === "all" || i.host === host) &&
        (project === "all" || i.project === project) &&
        (!needle || `${i.title} ${i.detail ?? ""} ${i.project ?? ""} ${i.agent}`.toLowerCase().includes(needle)),
    );
  }, [hub, q, source, host, project]);

  const groups = useMemo(() => {
    const out: { day: string; items: typeof filtered }[] = [];
    for (const i of filtered.slice(0, 300)) {
      const day = dayLabel(i.ts);
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(i);
    }
    return out;
  }, [filtered]);

  const waiting = (hub?.items ?? []).filter((i) => i.status === "waiting" || i.status === "running");
  const today = (hub?.items ?? []).filter((i) => dayLabel(i.ts) === "Today");

  return (
    <div className="flex flex-col gap-4">
      <HubError error={error} />
      <IndexingNote hub={hub} />
      <div className="panel flex flex-col gap-2 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search all activity — titles, projects, agents"
          aria-label="Search all activity"
          className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="panel-title pr-1">Tool</span>
          <Chip active={source === "all"} onClick={() => setSource("all")}>All</Chip>
          {facets.sources.map((s) => (
            <Chip key={s} active={source === s} onClick={() => setSource(s)}>{SOURCE_META[s].label}</Chip>
          ))}
          <span className="panel-title pl-3 pr-1">Machine</span>
          <Chip active={host === "all"} onClick={() => setHost("all")}>All</Chip>
          {facets.hosts.map((h) => (
            <Chip key={h} active={host === h} onClick={() => setHost(h)}>{h}</Chip>
          ))}
        </div>
        {facets.projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="panel-title pr-1">Project</span>
            <Chip active={project === "all"} onClick={() => setProject("all")}>All</Chip>
            {facets.projects.map((p) => (
              <Chip key={p} active={project === p} onClick={() => setProject(p)}>{p}</Chip>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={`Activity · ${filtered.length}`}>
          <div className="flex flex-col p-4">
            {hub && filtered.length === 0 && <EmptyState accent="cyan" title="No matches" hint="Try clearing a filter or the search box." />}
            {groups.map((g) => (
              <div key={g.day} className="pb-2">
                <p className="panel-title pb-1 pt-2">{g.day}</p>
                {g.items.map((i) => {
                  const row = (
                    <span className="flex items-center gap-3 border-b border-line py-2">
                      <span className="w-10 shrink-0 font-mono text-[10px] text-ink-faint">{clockTime(i.ts)}</span>
                      <SourcePill source={i.source} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink">{i.title}</span>
                        <span className="block truncate font-mono text-[10px] text-ink-faint">
                          {[i.agent, i.project, i.host, i.detail].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <StatusDot status={i.status} />
                    </span>
                  );
                  return i.href ? (
                    <Link key={i.id} href={i.href} className="block transition-colors hover:bg-white/[0.03]">
                      {row}
                    </Link>
                  ) : (
                    <div key={i.id}>{row}</div>
                  );
                })}
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Open right now">
            <div className="flex flex-col p-4">
              {hub && waiting.length === 0 && <EmptyState accent="lime" title="Nothing open" compact />}
              {waiting.slice(0, 8).map((i) => (
                <div key={i.id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
                  <StatusDot status={i.status} />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{i.title}</span>
                  <span className="font-mono text-[10px] text-ink-faint">{ago(i.ts)}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Today">
            <div className="grid grid-cols-3 gap-2 p-4 text-center">
              {[
                ["Actions", today.length],
                ["Tools", new Set(today.map((i) => i.source)).size],
                ["Projects", new Set(today.map((i) => i.project).filter(Boolean)).size],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-line py-2">
                  <p className="font-mono text-xl font-bold text-ink">{v}</p>
                  <p className="panel-title">{k}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
