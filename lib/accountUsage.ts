import type { SubscriptionMeter } from "./sessions";

/**
 * Usage per ACCOUNT, not per machine (Fleet → Accounts).
 *
 * The same Claude or ChatGPT login on four machines shares one set of limits, but every machine
 * reports its own meter. Each meter carries `account`: a short fingerprint of the login (a hash,
 * never the email), so meters from different machines can be added up here:
 *  - tokens: summed (each machine counts only its own session files, so they never overlap)
 *  - the limit: the NEWEST observation from any machine wins (a limit percentage or a "you've hit
 *    your limit" is the account's, wherever it was seen), unless its window has since reset
 *  - limited on one machine = limited on all of them, until the reset
 *
 * Pure (types only) so scripts/test-account-usage.mjs covers it, and the Fleet page can run it on
 * the meters it already has.
 */

export interface UsageMachine {
  host: string;
  label: string;
  stale?: boolean;
  subs: SubscriptionMeter[];
}

export interface AccountUsage {
  /** tool:fingerprint, or tool@host when the machine couldn't say which account it uses */
  key: string;
  tool: SubscriptionMeter["tool"];
  label: string;
  plan?: string;
  /** false = the machine didn't report an account (older version, or no login file): shown on its own */
  known: boolean;
  machines: { host: string; label: string; tokens5h: number; tokens7d: number; status: SubscriptionMeter["status"]; stale?: boolean }[];
  tokens5h: number;
  tokens7d: number;
  usedPercent?: number;
  windowLabel?: string;
  resetsAt?: number;
  /** when the limit figure was seen, and on which machine */
  observedAt?: number;
  observedOn?: string;
  status: SubscriptionMeter["status"];
  /** at the current pace, when the window fills up (only when that comes before the reset) */
  projectedFullAt?: number;
  note: string;
}

const H5 = 5 * 3_600_000;
const WORST: SubscriptionMeter["status"][] = ["limited", "near", "ok", "unknown", "not_set_up"];

/** Minutes in a limit window from its label ("5h window", "weekly", "daily"); undefined if unknown. */
export function windowMinutes(label?: string): number | undefined {
  if (!label) return undefined;
  if (label === "weekly") return 7 * 1_440;
  if (label === "daily") return 1_440;
  const h = label.match(/^(\d+)h window$/);
  if (h) return Number(h[1]) * 60;
  const m = label.match(/^(\d+)m window$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Straight-line projection: the share of the window used so far, over the time gone so far.
 * Needs at least 10 minutes of the window behind it and some use; nothing past the reset.
 */
export function projectFull(usedPercent: number, observedAt: number, resetsAt: number, windowMin: number): number | undefined {
  const start = resetsAt - windowMin * 60_000;
  const elapsed = observedAt - start;
  if (elapsed < 10 * 60_000 || usedPercent <= 0) return undefined;
  if (usedPercent >= 100) return observedAt;
  const full = observedAt + ((100 - usedPercent) / usedPercent) * elapsed;
  return full < resetsAt ? Math.round(full) : undefined;
}

/** Is this meter's "limited" still in force? A limit with a reset in the past is over; one with no reset counts for 5 hours. */
function limitedNow(m: SubscriptionMeter, now: number): boolean {
  if (m.status !== "limited") return false;
  if (m.resetsAt) return m.resetsAt > now;
  return now - (m.observedAt ?? 0) < H5;
}

export function accountUsage(machines: UsageMachine[], now = Date.now()): AccountUsage[] {
  const groups = new Map<string, { m: SubscriptionMeter; host: string; label: string; stale?: boolean }[]>();
  for (const mc of machines) {
    for (const s of mc.subs ?? []) {
      if (s.status === "not_set_up") continue;
      const key = s.account ? `${s.tool}:${s.account}` : `${s.tool}@${mc.host}`;
      const g = groups.get(key) ?? [];
      g.push({ m: s, host: mc.host, label: mc.label, stale: mc.stale });
      groups.set(key, g);
    }
  }

  const out: AccountUsage[] = [];
  for (const [key, g] of groups) {
    const first = g[0].m;
    const named = g.find((x) => x.m.accountLabel)?.m.accountLabel;
    // the newest limit reading from any machine is the account's (unless that window has reset since)
    const readings = g.filter((x) => typeof x.m.usedPercent === "number" && x.m.observedAt).sort((a, b) => (b.m.observedAt ?? 0) - (a.m.observedAt ?? 0));
    const top = readings[0];
    const reset = top?.m.resetsAt !== undefined && top.m.resetsAt < now;
    const usedPercent = top ? (reset ? 0 : top.m.usedPercent) : undefined;
    const limited = g.filter((x) => limitedNow(x.m, now)).sort((a, b) => (b.m.resetsAt ?? 0) - (a.m.resetsAt ?? 0))[0];

    let status: SubscriptionMeter["status"];
    if (limited) status = "limited";
    else if (usedPercent !== undefined) status = usedPercent >= 80 ? "near" : "ok";
    else status = g.map((x) => (x.m.status === "limited" ? "unknown" : x.m.status)).sort((a, b) => WORST.indexOf(a) - WORST.indexOf(b))[0] ?? "unknown";

    const wl = top?.m.windowLabel;
    const wm = windowMinutes(wl);
    const projectedFullAt =
      !limited && top && !reset && usedPercent !== undefined && top.m.resetsAt && wm ? projectFull(usedPercent, top.m.observedAt!, top.m.resetsAt, wm) : undefined;

    const tokens5h = g.reduce((n, x) => n + (x.m.tokens5h ?? 0), 0);
    const tokens7d = g.reduce((n, x) => n + (x.m.tokens7d ?? 0), 0);
    const where = limited?.label ?? top?.label;
    const note = limited
      ? `Limit reached on ${limited.label}${limited.m.resetsAt ? "" : " (reset time not recorded)"} — applies on every machine using this login.`
      : top
        ? `Limit figure from ${where}, the newest reading of ${g.length} machine${g.length === 1 ? "" : "s"}.`
        : first.tool === "claude"
          ? "Claude Code doesn't record how much of its limit is used, only when the limit is hit. Showing tokens from every machine on this login."
          : "This tool doesn't record its limits. Showing tokens from every machine on this login.";

    out.push({
      key,
      tool: first.tool,
      label: named || first.label,
      plan: g.find((x) => x.m.plan)?.m.plan,
      known: Boolean(first.account),
      machines: g.map((x) => ({ host: x.host, label: x.label, tokens5h: x.m.tokens5h ?? 0, tokens7d: x.m.tokens7d ?? 0, status: x.m.status, stale: x.stale })),
      tokens5h,
      tokens7d,
      usedPercent: limited && usedPercent === undefined ? undefined : usedPercent,
      windowLabel: limited?.m.windowLabel ?? wl,
      resetsAt: limited ? limited.m.resetsAt : reset ? undefined : top?.m.resetsAt,
      observedAt: limited?.m.observedAt ?? top?.m.observedAt,
      observedOn: where,
      status,
      projectedFullAt,
      note,
    });
  }
  const order = ["claude", "codex", "hermes", "kimi"];
  return out.sort((a, b) => order.indexOf(a.tool) - order.indexOf(b.tool) || b.machines.length - a.machines.length || b.tokens7d - a.tokens7d);
}

/**
 * The same machines, with each meter replaced by its ACCOUNT's limit state, for run placement and
 * Run somewhere: a login that hit its limit on Legion7 is limited on Raider18 too, and the newest
 * percentage seen anywhere is the one to rank by. Tokens and labels stay per machine.
 */
export function withAccountLimits<T extends { host: string; subs: SubscriptionMeter[] }>(machines: T[], now = Date.now()): T[] {
  const accounts = accountUsage(machines.map((m) => ({ host: m.host, label: m.host, subs: m.subs })), now);
  const byKey = new Map(accounts.filter((a) => a.known).map((a) => [a.key, a]));
  return machines.map((m) => ({
    ...m,
    subs: m.subs.map((s) => {
      const a = s.account ? byKey.get(`${s.tool}:${s.account}`) : undefined;
      if (!a || a.machines.length < 2 || s.status === "not_set_up") return s;
      return { ...s, status: a.status, usedPercent: a.usedPercent, resetsAt: a.resetsAt, windowLabel: a.windowLabel ?? s.windowLabel };
    }),
  }));
}

// ─── Claude's "you've hit your limit" lines ───

export interface ClaudeLimitHit {
  ts: number;
  kind: "session" | "weekly" | "other";
  resetsAt?: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Offset of a time zone from UTC at a moment, in ms (positive east of UTC). Undefined for an unknown zone. */
function tzOffset(at: number, tz: string): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(at));
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
    return asUtc - Math.floor(at / 1000) * 1000;
  } catch {
    return undefined;
  }
}

/** The UTC moment of a wall-clock time in a zone (two passes, so a DST change between them is handled). */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number | undefined {
  const guess = Date.UTC(y, mo, d, h, mi);
  const o1 = tzOffset(guess, tz);
  if (o1 === undefined) return undefined;
  const o2 = tzOffset(guess - o1, tz) ?? o1;
  return guess - o2;
}

function wallDate(at: number, tz: string): { y: number; mo: number; d: number } | undefined {
  const o = tzOffset(at, tz);
  if (o === undefined) return undefined;
  const w = new Date(at + o);
  return { y: w.getUTCFullYear(), mo: w.getUTCMonth(), d: w.getUTCDate() };
}

/**
 * When a Claude limit resets, from the line Claude Code writes into the session file:
 *   "You've hit your session limit · resets 6:10pm (America/New_York)"
 *   "You've hit your weekly limit · resets Nov 28, 3pm (Europe/London)"
 *   "Claude AI usage limit reached|1764358800"   (older versions: epoch seconds)
 * The reset is the first such time AFTER the line was written. No zone given = this machine's.
 */
export function parseClaudeLimit(text: string, ts: number, localTz?: string): ClaudeLimitHit {
  const t = text.replace(/Â/g, "");
  const kind: ClaudeLimitHit["kind"] = /weekly/i.test(t) ? "weekly" : /session|5-hour|five-hour/i.test(t) ? "session" : "other";
  const epoch = t.match(/\|(\d{10})\b/);
  if (epoch) return { ts, kind, resetsAt: Number(epoch[1]) * 1000 };
  const m = t.match(/resets\s+(?:on\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i);
  if (!m) return { ts, kind };
  const tz = m[6]?.trim() || localTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  let h = Number(m[3]);
  const mi = m[4] ? Number(m[4]) : 0;
  const ap = m[5]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59) return { ts, kind };
  const today = wallDate(ts, tz);
  if (!today) return { ts, kind };
  if (m[1] && m[2]) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo < 0) return { ts, kind };
    let at = zonedToUtc(today.y, mo, Number(m[2]), h, mi, tz);
    if (at !== undefined && at < ts - 86_400_000) at = zonedToUtc(today.y + 1, mo, Number(m[2]), h, mi, tz);
    return { ts, kind, resetsAt: at };
  }
  let at = zonedToUtc(today.y, today.mo, today.d, h, mi, tz);
  if (at !== undefined && at <= ts) at = zonedToUtc(today.y, today.mo, today.d + 1, h, mi, tz);
  return { ts, kind, resetsAt: at };
}
