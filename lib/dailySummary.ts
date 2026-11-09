import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { sessionsSnapshot } from "./sessions";
import { mergeRemoteSessions } from "./sessionShare";
import { eventsBetween, readAlertSettings } from "./sessionEvents";
import { listJobs } from "./sessionActions";
import { sendTelegram } from "./telegram";

/**
 * Once a day (after 6 AM, run by the master) a note on what every machine did
 * the day before: sessions active and started per machine, projects touched,
 * long turns that finished, times sessions waited on you, and runs started
 * from Mission Control. Written to Agentic OS/Daily Summaries/<date> Machines.md;
 * optionally sent on Telegram (Fleet → Session alerts).
 */

const STATE = path.join(process.cwd(), "data", "daily-summary.json");

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function buildDailySummary(day: Date): Promise<{ markdown: string; short: string }> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [from, to] = [start.getTime(), end.getTime()];

  const snap = await sessionsSnapshot();
  const [{ sessions, remote }, cfg, events, jobs] = await Promise.all([
    mergeRemoteSessions(snap.sessions),
    readConfig().catch(() => null),
    eventsBetween(from, to),
    listJobs(),
  ]);
  const labelOf = (host: string) => (host === os.hostname() ? cfg?.label || host : (remote.find((r) => r.host === host)?.label ?? host));
  const active = sessions.filter((s) => !s.indexing && s.updatedAt >= from && s.startedAt < to);
  const hosts = [...new Set(active.map((s) => s.host))].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

  const lines: string[] = [];
  const short: string[] = [`📋 ${dayKey(start)} across your machines`];
  for (const h of hosts) {
    const mine = active.filter((s) => s.host === h);
    const started = mine.filter((s) => s.startedAt >= from).length;
    const projects = new Map<string, number>();
    for (const s of mine) projects.set(s.project, (projects.get(s.project) ?? 0) + 1);
    const top = [...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ev = events.filter((e) => e.host === h);
    const finishedLong = ev.filter((e) => e.kind === "finished" && e.long);
    const waited = ev.filter((e) => e.kind === "waiting").length;
    const files = ev.reduce((n, e) => n + (e.filesChanged ?? 0), 0);
    const claude = mine.filter((s) => s.tool === "claude").length;
    lines.push(
      `## ${labelOf(h)}`,
      "",
      `- **${mine.length} sessions active** (${claude} Claude Code, ${mine.length - claude} Codex) · ${started} started that day`,
      `- Projects: ${top.map(([p, n]) => `${p} (${n})`).join(", ") || "—"}`,
      ev.length ? `- ${ev.filter((e) => e.kind === "finished").length} turns finished${files ? ` · ${files} file edits` : ""} · waited on you ${waited} time${waited === 1 ? "" : "s"}` : "- No session alerts recorded (the hook may not be installed there yet)",
      ...finishedLong.map((e) => `  - Long run: **${e.title}** - ${Math.round((e.turnMs ?? 0) / 60_000)} min${e.filesChanged ? `, ${e.filesChanged} files changed` : ""}`),
      "",
    );
    short.push(`• ${labelOf(h)}: ${mine.length} sessions · ${top.slice(0, 3).map(([p]) => p).join(", ") || "—"}${finishedLong.length ? ` · ${finishedLong.length} long runs` : ""}${waited ? ` · waited ${waited}×` : ""}`);
  }
  const mc = jobs.filter((j) => j.createdAt >= from && j.createdAt < to && !j.requestedBy);
  if (mc.length) {
    lines.push(
      "## Started from Mission Control",
      "",
      ...mc.map((j) => `- ${j.mode === "new" ? "New session" : j.mode === "reply" ? "Reply" : j.mode} on ${j.hostLabel}: ${(j.title ?? j.prompt).slice(0, 80)} - ${j.status}`),
      "",
    );
  }
  if (!hosts.length) {
    lines.push("No sessions were active on any machine.", "");
    short.push("• No sessions were active.");
  }
  const markdown = [
    "---",
    `date: ${dayKey(start)}`,
    "tags: [daily-summary, machines]",
    "---",
    "",
    `# ${start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} - your machines`,
    "",
    "Written by Mission Control from session summaries and session alerts.",
    "",
    ...lines,
  ].join("\n");
  return { markdown, short: short.join("\n") };
}

/** Master tick: yesterday's summary, once, after 6 AM. */
export async function maybeDailySummary(): Promise<void> {
  const now = new Date();
  if (now.getHours() < 6) return;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const key = dayKey(y);
  const state = await fsp
    .readFile(STATE, "utf8")
    .then((t) => JSON.parse(t) as { lastDate?: string })
    .catch(() => ({}) as { lastDate?: string });
  if (state.lastDate === key || !(await vaultAvailable())) return;
  await fsp.writeFile(STATE, JSON.stringify({ lastDate: key, at: Date.now() }), "utf8"); // claim first: never twice
  const { markdown, short } = await buildDailySummary(y);
  const dir = path.join(vaultInfo().base, "Daily Summaries");
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${key} Machines.md`), markdown, "utf8");
  if ((await readAlertSettings()).telegram.daily) await sendTelegram(short).catch(() => false);
}
