/**
 * The pure half of the remote-action log (lib/remoteLog.ts): its record types and the cross-check
 * that flags a request its named sender has no record of sending. No imports, so
 * scripts/test-remote-log.mjs and the Fleet page can both use it.
 */

export type RemoteKind = "reply" | "new" | "thread" | "stop" | "import" | "export" | "check" | "update" | "setup" | "local" | "permission" | "skill";

export interface RemoteAction {
  /** the job id (the same on both ends), or perm-<id> for a permission answer */
  id: string;
  at: number;
  dir: "in" | "out";
  /** the machine the action was carried out on */
  host: string;
  hostLabel?: string;
  /** the machine that asked for it */
  from: string;
  fromLabel?: string;
  kind: RemoteKind;
  via?: "lan" | "vault";
  /** one line: the session, folder, setup change or permission */
  what: string;
  access?: "answer" | "edit";
  outcome: "accepted" | "refused" | "sent" | "failed";
  reason?: string;
  /** filled in when shared: the job's final state on this machine */
  status?: string;
}

export interface SharedLog {
  v: 1;
  host: string;
  label: string;
  publishedAt: number;
  /** entries from this time on are all here (older ones were dropped by the cap) */
  coversFrom: number;
  entries: RemoteAction[];
}

// ─── the cross-check ───

export interface CheckedAction extends RemoteAction {
  /** where this record came from (whose log) */
  loggedBy: string;
  /** set when the asking machine's own log should show this request and doesn't */
  unmatched?: string;
}

/**
 * Merge every machine's log, one row per action (the target's "in" record preferred, with the
 * sender's "out" folded into it), and flag an accepted request the named sender has no record of
 * sending. Only judged when the sender's log is recent and covers that moment, so a machine on an
 * older version (no log at all) or a slow vault sync doesn't raise false alarms.
 */
export function crossCheck(logs: SharedLog[], now = Date.now()): CheckedAction[] {
  const byHost = new Map(logs.map((l) => [l.host.toLowerCase(), l]));
  const outIds = new Map<string, Set<string>>();
  for (const l of logs) outIds.set(l.host.toLowerCase(), new Set(l.entries.filter((e) => e.dir === "out").map((e) => e.id)));

  const rows = new Map<string, CheckedAction>();
  for (const l of logs) {
    for (const e of l.entries) {
      const key = `${e.id}|${e.host.toLowerCase()}`;
      const prev = rows.get(key);
      if (prev && prev.dir === "in") {
        if (e.dir === "out" && !prev.status && e.status) prev.status = e.status;
        continue;
      }
      rows.set(key, { ...e, loggedBy: l.host, status: e.status ?? prev?.status });
    }
  }
  for (const r of rows.values()) {
    if (r.dir !== "in" || r.outcome === "refused") continue;
    const sender = byHost.get(r.from.toLowerCase());
    if (!sender) continue; // it keeps no log (older version) or isn't sharing one: nothing to compare
    const covered = sender.coversFrom <= r.at - 60_000 && sender.publishedAt >= r.at + 2 * 60_000 && now - sender.publishedAt < 24 * 3_600_000;
    if (covered && !outIds.get(r.from.toLowerCase())?.has(r.id)) {
      r.unmatched = `${sender.label || r.fromLabel || r.from} has no record of sending this.`;
    }
  }
  return [...rows.values()].sort((a, b) => b.at - a.at);
}
