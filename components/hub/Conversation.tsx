"use client";

import { useEffect, useState } from "react";
import Markdown from "../Markdown";

/**
 * "Conversation" toggle for a session row: loads the session's messages and
 * replies (no tool output, secrets redacted) — live from this machine, or from
 * the vault digest another machine shared.
 */
export function ConversationButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title="Read this session's conversation"
      className="shrink-0 cursor-pointer rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink"
    >
      {open ? "Hide" : "Read"}
    </button>
  );
}

export function ConversationView({ sessionKey }: { sessionKey: string }) {
  const [state, setState] = useState<{ loading: boolean; md?: string; error?: string; source?: string; machine?: string }>({ loading: true });

  useEffect(() => {
    let live = true;
    setState({ loading: true });
    fetch(`/api/hub/conversation?key=${encodeURIComponent(sessionKey)}`)
      .then(async (r) => {
        const b = (await r.json()) as { markdown?: string; error?: string; source?: string; machine?: string };
        if (live) setState({ loading: false, md: b.markdown, error: b.error, source: b.source, machine: b.machine });
      })
      .catch((e: Error) => live && setState({ loading: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [sessionKey]);

  return (
    <div className="mb-2 mt-1 rounded-xl border border-line bg-black/[0.08] px-3 py-2">
      {state?.loading && <p className="font-mono text-[10px] text-ink-faint">Loading conversation…</p>}
      {state?.error && <p className="text-[11px] text-ink-faint">{state.error}</p>}
      {state?.md && (
        <>
          <p className="pb-1 font-mono text-[10px] text-ink-faint">
            {state.source === "vault" ? `Shared by ${state.machine} through the vault` : "Read live from this machine"} · tool calls left out, secrets redacted
          </p>
          <div className="max-h-[55vh] overflow-y-auto text-xs">
            <Markdown>{state.md}</Markdown>
          </div>
        </>
      )}
    </div>
  );
}
