import { spawnSync } from "child_process";
import { cleanEnv } from "./runners";

/**
 * GitHub access for the GitHub dashboard (lib/githubReport.ts), through the official GitHub CLI's
 * sign-ins. Each account is signed in by the owner with `gh auth login` (the CLI keeps several);
 * Mission Control asks the CLI for that account's token when it collects and keeps it in memory for
 * that collection only: never written to disk, never logged, never sent anywhere but api.github.com.
 * Without a sign-in only public repositories can be listed (60 requests an hour).
 *
 * gh must be signed in from a NORMAL terminal: one inside the packaged Claude desktop app keeps its
 * settings in that app's private folder, which Mission Control can't see (AGENTS.md rule 39 note).
 */

export interface GhAccount {
  login: string;
  active: boolean;
}

const API = "https://api.github.com";

function gh(args: string[], timeoutMs = 15_000): { out: string; err: string; code: number | null } {
  const r = spawnSync("gh", args, { encoding: "utf8", env: cleanEnv(), windowsHide: true, timeout: timeoutMs });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.error ? -1 : r.status };
}

/** The accounts the GitHub CLI is signed in to on github.com. */
export function ghAccounts(): { installed: boolean; accounts: GhAccount[]; note?: string } {
  const r = gh(["auth", "status", "--hostname", "github.com"]);
  if (r.code === -1) return { installed: false, accounts: [], note: "The GitHub CLI (gh) isn't installed on this machine." };
  const text = `${r.out}\n${r.err}`;
  const accounts: GhAccount[] = [];
  const blocks = text.split(/(?=Logged in to github\.com)/);
  for (const b of blocks) {
    const m = b.match(/Logged in to github\.com (?:account|as) ([\w-]+)/);
    if (m) accounts.push({ login: m[1], active: /Active account:\s*true/i.test(b) });
  }
  return { installed: true, accounts, note: accounts.length ? undefined : "The GitHub CLI isn't signed in. In a normal PowerShell window run: gh auth login --hostname github.com --git-protocol https --web" };
}

/** That account's token, from the CLI, for this collection only. */
export function ghToken(login: string): string | null {
  if (!/^[\w-]{1,39}$/.test(login)) return null;
  const r = gh(["auth", "token", "--hostname", "github.com", "--user", login]);
  const tok = r.out.trim();
  return r.code === 0 && /^[\w-]{20,}$/.test(tok) ? tok : null;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const headers = (token?: string, accept = "application/vnd.github+json"): Record<string, string> => ({
  Accept: accept,
  "User-Agent": "mission-control",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** One GraphQL query. Partial data with field errors (e.g. no access to security alerts) is returned, not thrown. */
export async function graphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<{ data: T; errors: string[] }> {
  const res = await fetch(`${API}/graphql`, { method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(45_000) });
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[]; message?: string };
  if (!res.ok && !body.data) throw new GitHubError(body.message || `GitHub answered ${res.status}`, res.status);
  if (!body.data) throw new GitHubError((body.errors ?? []).map((e) => e.message).join("; ") || "no data", res.status);
  return { data: body.data, errors: (body.errors ?? []).map((e) => e.message ?? "error") };
}

/** One REST GET. `raw` returns the file bytes of a contents request. */
export async function rest<T = unknown>(path: string, token?: string, opts: { raw?: boolean } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: headers(token, opts.raw ? "application/vnd.github.raw" : undefined), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const msg = ((await res.json().catch(() => ({}))) as { message?: string }).message;
    throw new GitHubError(msg || `GitHub answered ${res.status}`, res.status);
  }
  return (opts.raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T;
}
