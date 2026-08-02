"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Markdown from "./Markdown";
import { useMission } from "./store";

interface ProfileData {
  exists: boolean;
  note: string;
  maxChars: number;
  lastRun: number | null;
  lastStatus: string | null;
  writer: string;
}

/** Strip frontmatter + the generated banner for display, same as injection does. */
function body(note: string): string {
  return note
    .replace(/^---[\s\S]*?---\s*/, "")
    .replace(/^#\s+User Profile[^\n]*\s*/, "")
    .replace(/^>[^\n]*\n?/gm, "")
    .trim();
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export default function UserProfilePanel() {
  const { addEvent } = useMission();
  const [data, setData] = useState<ProfileData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profile");
      if (res.ok) setData((await res.json()) as ProfileData);
    } catch {
      /* server restarting */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setErr("");
    setNote("");
    setBusy(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as { error?: string; chars?: number; compressed?: boolean; truncated?: boolean };
      if (!res.ok) {
        setErr(j.error ?? "refresh failed");
      } else {
        setNote(
          `Updated — ${j.chars} chars${j.compressed ? " (compressed to fit)" : ""}${j.truncated ? " (tail trimmed)" : ""}`,
        );
        addEvent("PROFILE", `user profile refreshed — ${j.chars} chars`, "violet");
        await load();
        setOpen(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const text = data ? body(data.note) : "";

  return (
    <Panel
      title="User Profile"
      right={
        <span className="font-mono text-[10px] text-ink-faint">
          {data?.exists ? `${text.length}/${data.maxChars} chars · every agent sees this` : "not built yet"}
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-ink-dim">
          A maintained &ldquo;who you are working with&rdquo; note, distilled from your chats, goals, tasks and journal.
          It is injected into <strong>every</strong> agent&apos;s prompt, refreshes weekly on the cluster master, and is
          rewritten (not appended) each time. Edit{" "}
          <code className="font-mono text-[11px]">Agentic OS/User Profile.md</code> by hand to correct it — the next
          refresh merges your edit rather than discarding it.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <StatusOrb accent={data?.exists ? "lime" : "amber"} pulsing={false} size={8} />
          <span className="text-xs text-ink-dim">
            {data?.lastRun ? `refreshed ${relTime(data.lastRun)}` : "never refreshed"}
            {data?.lastStatus ? ` · ${data.lastStatus}` : ""}
          </span>
          <button
            onClick={refresh}
            disabled={busy}
            className="ml-auto cursor-pointer rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink transition hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Refreshing…" : "Refresh now"}
          </button>
          {data?.exists && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="cursor-pointer rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-dim transition hover:border-ink-faint"
            >
              {open ? "Hide" : "View"}
            </button>
          )}
        </div>

        {err && <p className="text-xs text-rose-400">{err}</p>}
        {note && <p className="text-xs text-lime-400">{note}</p>}

        {open && text && (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <Markdown>{text}</Markdown>
          </div>
        )}
      </div>
    </Panel>
  );
}
