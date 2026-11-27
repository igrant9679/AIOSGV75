import zlib from "zlib";

/**
 * Reading the status documents kept in a repository ("this week", changes, status, handoff, next
 * session, to-do) for the GitHub dashboard (lib/githubReport.ts): which files count, the text of a
 * .docx without any library, and the "waiting on you" items inside them.
 *
 * Pure apart from zlib (Node built-in), so scripts/test-github-docs.mjs tests it directly.
 */

const DOC_EXT = /\.(md|markdown|txt|docx)$/i;

/**
 * How likely a file is to be a status document, 0 = not one. "This week" documents first, then
 * change/status/handoff notes; a README or a licence never.
 */
export function docScore(path: string): number {
  const name = path.split("/").pop() ?? path;
  if (!DOC_EXT.test(name)) return 0;
  const n = name.toLowerCase().replace(/[_\s]+/g, "-");
  if (/this-?week|week-?\d|weekly|wk-?\d/.test(n)) return 10;
  if (/waiting|action-?items|for-?you|todo|to-do/.test(n)) return 8;
  if (/changes|changelog|what-?changed|release-?notes/.test(n)) return 7;
  if (/status|progress|handoff|hand-off|next-?session|start-?here|roadmap/.test(n)) return 6;
  return 0;
}

// ─── .docx → text ───

/** The files inside a zip, by name → raw bytes (stored or deflated entries only). */
export function unzip(buf: Buffer, want?: (name: string) => boolean): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory: signature 0x06054b50, within the last 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (want && !want(name))) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, zlib.inflateRawSync(data));
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** The text of one <w:p>, with tabs. */
function paraText(xml: string): string {
  return decode(
    (xml.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
      .map((m) => (m === "<w:tab/>" ? "\t" : m === "<w:br/>" ? " " : m.replace(/<[^>]+>/g, "")))
      .join(""),
  ).trim();
}

/**
 * A .docx as markdown-ish text: headings become "#" lines (Title / Heading 1-6), table rows become
 * "| a | b |" lines, every other paragraph a line. Enough to find sections and their items.
 */
export function docxText(buf: Buffer): string {
  const files = unzip(buf, (n) => n === "word/document.xml");
  const xml = files.get("word/document.xml")?.toString("utf8");
  if (!xml) throw new Error("no word/document.xml");
  const body = xml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (tr) => {
    const cells = (tr.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []).map((tc) => (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(paraText).filter(Boolean).join(" "));
    return `<w:p><w:r><w:t>${cells.map((c) => c.replace(/[<&]/g, (ch) => (ch === "<" ? "&lt;" : "&amp;"))).join(" | ").replace(/^/, "| ").replace(/$/, " |")}</w:t></w:r></w:p>`;
  });
  const lines: string[] = [];
  for (const p of body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    const text = paraText(p);
    if (!text) continue;
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const level = /^title$/i.test(style) ? 1 : Number(style.match(/^heading\s?(\d)$/i)?.[1] ?? 0);
    const listed = /<w:numPr>/.test(p);
    lines.push(level ? `${"#".repeat(level)} ${text}` : listed ? `- ${text}` : text);
  }
  return lines.join("\n");
}

// ─── "waiting on you" ───

const WAITING_RE =
  /waiting on (you|me|idris|sabine|the owner|us)|for you(?: to do)?\b|needs? (you|your)|action items?|\bto.?do\b|next steps?|decisions? (needed|for you)|blocked on (you|me)|your (move|turn)|open questions|what i need from you|follow.?ups?/i;

/** A section that names the owner ("waiting on you", "for you", "decisions needed"), not just a to-do list. */
const DIRECT_RE = /waiting on (you|me|idris|sabine|the owner)|for you\b|needs? (you|your)|decisions?|blocked on (you|me)|your (move|turn)|what i need from you|open questions/i;

export interface WaitingItem {
  text: string;
  /** the heading it was found under */
  section: string;
  /** true when the section is addressed to the owner; false for a generic to-do / next-steps list */
  direct: boolean;
}

/**
 * The items under "Waiting on you" / "For you to do" / "Next steps" style sections: bullets, numbered
 * items, unchecked boxes and table rows (not the header row, not rows marked done). A bold line
 * ending in a colon counts as a heading ("**For you to do:**").
 */
export function extractWaiting(text: string, max = 25): WaitingItem[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: WaitingItem[] = [];
  let section: { title: string; level: number } | null = null;
  let tableHeader = true;
  // the item a hard-wrapped bullet's indented next line belongs to ("1. **Checkpoints.** Approve …\n   delivery …")
  let lastItem: WaitingItem | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) lastItem = null;
    else if (lastItem && /^(\s{2,}|\t)/.test(raw) && !/^([-*•]\s|\d+[.)]\s|\||#)/.test(line)) {
      const joined = `${lastItem.text} ${line.replace(/\*\*/g, "")}`.replace(/\s+/g, " ");
      lastItem.text = joined.length > 300 ? `${joined.slice(0, 297)}…` : joined;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const pseudo = h ? null : line.match(/^\*\*([^*]{3,80}?):?\*\*:?$/);
    if (h || pseudo) {
      const level = h ? h[1].length : 6;
      const title = (h ? h[2] : (pseudo as RegExpMatchArray)[1]).replace(/[*_`]/g, "").trim();
      lastItem = null;
      if (section && level > section.level && !WAITING_RE.test(title)) continue; // a sub-heading inside the section
      section = WAITING_RE.test(title) ? { title, level } : null;
      tableHeader = true;
      continue;
    }
    if (!section || !line) continue;
    let item = "";
    if (/^\|/.test(line)) {
      if (/^\|[\s:|-]+\|?$/.test(line)) continue; // separator row
      if (tableHeader) {
        tableHeader = false;
        continue;
      }
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.some((c) => /^(done|✅|complete|completed|closed)$/i.test(c))) continue;
      item = cells.join(" — ");
    } else if (/^[-*•]\s+\[[xX]\]/.test(line)) continue; // checked box: done
    else if (/^[-*•]\s+|^\d+[.)]\s+/.test(line)) item = line.replace(/^[-*•]\s+(\[[ ~/-]\]\s*)?|^\d+[.)]\s+/, "");
    else continue; // prose under the heading: not an item
    item = item.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    if (item.length < 3) continue;
    lastItem = { text: item.length > 300 ? `${item.slice(0, 297)}…` : item, section: section.title, direct: DIRECT_RE.test(section.title) };
    out.push(lastItem);
    if (out.length >= max) break;
  }
  return out;
}
