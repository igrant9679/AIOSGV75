import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFile } from "child_process";

/**
 * Read/write Hermes's model + fallback chain from Mission Control.
 *
 * Hermes stores this in `%LOCALAPPDATA%\hermes\config.yaml` — NOT `~/.hermes/`,
 * which doesn't exist despite what several docs claim. Two deliberate choices:
 *
 *  - We edit the YAML **textually** rather than parse/re-serialise it. There's no
 *    yaml dep in this project, and more importantly `hermes config set` rewrites
 *    the whole file and DROPS every trailing comment block (the Security and
 *    Fallback-Model documentation Hermes ships inline). Surgical edits keep them.
 *  - Every write is backed up, then **verified by asking the Hermes CLI itself**
 *    what it now sees. If the CLI disagrees, we restore the backup. A malformed
 *    config would otherwise break the agent silently until its next run.
 *
 * Per-machine: this only ever touches the config on the box the server runs on.
 * A picker on the desktop cannot change the laptop's Hermes.
 */

export interface HermesChainEntry {
  provider: string;
  model: string;
}

export interface HermesChain {
  primary: HermesChainEntry | null;
  fallbacks: HermesChainEntry[];
  configPath: string;
  exists: boolean;
}

export interface NousModel {
  id: string;
  /** USD per 1M prompt / completion tokens. 0 = genuinely free. */
  inPerM: number;
  outPerM: number;
  free: boolean;
}

function configPath(): string {
  if (process.env.HERMES_CONFIG) return process.env.HERMES_CONFIG;
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "hermes", "config.yaml");
}

function authPath(): string {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(local, "hermes", "auth.json");
}

/** `default:` inside the top-level `model:` block (not any nested `default:`). */
const MODEL_BLOCK = /^model:\r?\n((?:[ \t]+.*\r?\n?)*)/m;

function readModelBlock(text: string): { provider: string; model: string } | null {
  const block = MODEL_BLOCK.exec(text);
  if (!block) return null;
  const body = block[1];
  const model = /^[ \t]+default:[ \t]*(.+?)[ \t]*$/m.exec(body)?.[1];
  const provider = /^[ \t]+provider:[ \t]*(.+?)[ \t]*$/m.exec(body)?.[1];
  if (!model) return null;
  return { provider: (provider ?? "nous").replace(/['"]/g, ""), model: model.replace(/['"]/g, "") };
}

/** Top-level `fallback_providers:` list up to the next top-level key. */
const FALLBACK_BLOCK = /^fallback_providers:[ \t]*\r?\n((?:[ \t]*[-#].*\r?\n?|[ \t]+.*\r?\n?)*)/m;

function readFallbacks(text: string): HermesChainEntry[] {
  const block = FALLBACK_BLOCK.exec(text);
  if (!block) return [];
  const out: HermesChainEntry[] = [];
  // entries look like `- provider: nous` / `  model: tencent/hy3:free`
  const re = /-[ \t]*provider:[ \t]*(.+?)[ \t]*\r?\n[ \t]*model:[ \t]*(.+?)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[1])) !== null) {
    out.push({ provider: m[1].replace(/['"]/g, ""), model: m[2].replace(/['"]/g, "") });
  }
  return out;
}

export async function readHermesChain(): Promise<HermesChain> {
  const p = configPath();
  try {
    const text = await fs.readFile(p, "utf8");
    return { primary: readModelBlock(text), fallbacks: readFallbacks(text), configPath: p, exists: true };
  } catch {
    return { primary: null, fallbacks: [], configPath: p, exists: false };
  }
}

/** Ask the CLI what it actually sees — the only trustworthy check that a write parsed. */
function hermesFallbackList(): Promise<string> {
  const bin = process.env.HERMES_BIN || "hermes";
  return new Promise((resolve) => {
    execFile(bin, ["fallback", "list"], { shell: true, timeout: 60_000 }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

/**
 * Match the file's existing line ending. Hermes writes CRLF on Windows, and
 * emitting bare LF here left a 3-line island of LF in an otherwise CRLF file —
 * parsed fine, but it shows up as a spurious diff in every editor afterwards.
 */
function renderFallbacks(entries: HermesChainEntry[], eol: string): string {
  if (entries.length === 0) return "";
  return `fallback_providers:${eol}${entries.map((e) => `- provider: ${e.provider}${eol}  model: ${e.model}${eol}`).join("")}`;
}

function detectEol(text: string): string {
  return (text.match(/\r\n/g)?.length ?? 0) > (text.match(/(?<!\r)\n/g)?.length ?? 0) ? "\r\n" : "\n";
}

export interface WriteResult {
  ok: boolean;
  error?: string;
  chain?: HermesChain;
}

export async function writeHermesChain(primaryModel: string, fallbacks: HermesChainEntry[]): Promise<WriteResult> {
  const p = configPath();
  let original: string;
  try {
    original = await fs.readFile(p, "utf8");
  } catch {
    return { ok: false, error: `Hermes config not found at ${p} — is Hermes installed on this machine?` };
  }

  let next = original;

  // 1. primary — rewrite only the `default:` line inside the top-level model block
  const block = MODEL_BLOCK.exec(next);
  if (!block) return { ok: false, error: "could not locate the top-level `model:` block in config.yaml" };
  const patchedBlock = block[0].replace(/^([ \t]+default:[ \t]*).*$/m, `$1${primaryModel}`);
  next = next.slice(0, block.index) + patchedBlock + next.slice(block.index + block[0].length);

  // 2. fallbacks — replace the whole list, or insert one after the model block
  const fb = FALLBACK_BLOCK.exec(next);
  const rendered = renderFallbacks(fallbacks, detectEol(original));
  if (fb) {
    next = next.slice(0, fb.index) + rendered + next.slice(fb.index + fb[0].length);
  } else if (rendered) {
    const mb = MODEL_BLOCK.exec(next)!;
    const at = mb.index + mb[0].length;
    next = next.slice(0, at) + rendered + next.slice(at);
  }

  const backup = `${p}.bak-mc`;
  await fs.writeFile(backup, original, "utf8");
  await fs.writeFile(p, next, "utf8");

  // 3. verify with the CLI; restore the backup if it can't read what we wrote
  const listing = await hermesFallbackList();
  if (!listing.includes(primaryModel)) {
    await fs.writeFile(p, original, "utf8");
    return {
      ok: false,
      error: listing
        ? `Hermes did not report the new primary after the write — config restored from backup.`
        : `Could not run \`hermes fallback list\` to verify — config restored from backup. Is the Hermes CLI on this machine's PATH?`,
    };
  }
  return { ok: true, chain: await readHermesChain() };
}

/**
 * Models available on the Nous Portal subscription, with pricing so the UI can
 * say which are genuinely free. The access token is a ~1h JWT that Hermes
 * refreshes itself; we only ever read it, never store or forward it.
 */
export async function listNousModels(): Promise<NousModel[]> {
  let token: string;
  try {
    const auth = JSON.parse(await fs.readFile(authPath(), "utf8")) as {
      providers?: { nous?: { access_token?: string; inference_base_url?: string } };
    };
    token = auth.providers?.nous?.access_token ?? "";
    if (!token) return [];
  } catch {
    return [];
  }
  try {
    const res = await fetch("https://inference-api.nousresearch.com/v1/models", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    return (json.data ?? [])
      // /v1/models includes ~25 embedding/retrieval models. They can't answer a
      // chat turn, so offering them in a chat-model picker is just a way to break
      // Hermes — and they sort to the top because completion pricing is 0.
      .filter((m) => !/embed|bge-|e5-|gte-|minilm|mpnet|paraphrase|relace-search|^voyageai\//i.test(m.id))
      .map((m) => {
        const inPerM = parseFloat(m.pricing?.prompt ?? "0") * 1e6;
        const outPerM = parseFloat(m.pricing?.completion ?? "0") * 1e6;
        return { id: m.id, inPerM, outPerM, free: inPerM === 0 && outPerM === 0 };
      })
      // cheapest first: free models are what you usually want as the primary
      .sort((a, b) => a.outPerM - b.outPerM || a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}
