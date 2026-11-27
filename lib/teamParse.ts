/**
 * Reading the Team channel (lib/team.ts): who a message names, and the hand-offs at the end of a
 * teammate's reply. Pure, no imports: scripts/test-fallback.mjs tests it.
 */

type Named = { id: string; name: string };

/** "@Ada …" → the teammates named, in the order written. Pure, so the test can check it. */
export function mentions(text: string, members: Named[]): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(^|[^\w@])@([A-Za-z][\w-]{0,23})/g)) {
    const hit = members.find((x) => x.name.toLowerCase() === m[2].toLowerCase());
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

/** The hand-offs at the end of a teammate's reply: lines "@Name: what to do". Pure. */
export function handoffs(reply: string, members: Named[], self: string): { to: string; text: string }[] {
  const out: { to: string; text: string }[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:[-*]\s*)?\*{0,2}@([A-Za-z][\w-]{0,23})\*{0,2}\s*[:—–-]\s*(.+)$/);
    if (!m) continue;
    const hit = members.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
    if (hit && hit.id !== self && !out.some((o) => o.to === hit.id)) out.push({ to: hit.id, text: m[2].trim() });
  }
  return out;
}
