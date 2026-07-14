import fs from "fs/promises";
import path from "path";
import os from "os";
import { vaultInfo, vaultAvailable } from "./vault";

/**
 * Cluster coordination across machines that share ONE vault (via OneDrive) but
 * never talk to each other directly. Leader election runs entirely through
 * files in the vault:
 *   - each node writes a heartbeat to Agentic OS/Cluster/nodes/<host>.json
 *   - the "master" holds a time-limited lease (Agentic OS/Cluster/lease.json)
 *     that it renews every scheduler tick; if it stops renewing (machine down),
 *     an eligible backup claims the expired lease and takes over master duties
 *     (schedules, watchers, attention nudges, daily vault scaffold).
 *
 * This is EVENTUALLY consistent — OneDrive sync takes seconds to a minute — so
 * the lease TTL is generous and failover is measured in minutes, not seconds.
 * Roles: "primary" (preferred master), "backup" (takes over if the primary is
 * down), "workstation" (never master). Clustering is OFF by default: a lone
 * machine just runs its duties as always.
 */
export type Role = "primary" | "backup" | "workstation";

export interface ClusterConfig {
  enabled: boolean;
  role: Role;
  installDir: string;
  label: string;
}

interface Lease {
  holder: string;
  role: Role;
  renewedAt: number;
  expiresAt: number;
  term: number;
}

interface NodeInfo {
  host: string;
  role: Role;
  installDir: string;
  label: string;
  platform: string;
  ts: number;
  isMaster: boolean;
}

const CONFIG_FILE = path.join(process.cwd(), "data", "cluster.json");
const LEASE_TTL_MS = 6 * 60_000; // master lease lifetime (renewed every 30s tick)
const NODE_STALE_MS = 3 * 60_000; // a node is "offline" if unheard-from this long

const ROLES: Role[] = ["primary", "backup", "workstation"];

function clusterDir(): string {
  return path.join(vaultInfo().base, "Cluster");
}
function nodesDir(): string {
  return path.join(clusterDir(), "nodes");
}
function leaseFile(): string {
  return path.join(clusterDir(), "lease.json");
}
function nodeFile(host: string): string {
  return path.join(nodesDir(), `${host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
}

export function nodeId(): string {
  return os.hostname();
}

export async function readConfig(): Promise<ClusterConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) as Partial<ClusterConfig>;
    return {
      enabled: Boolean(raw.enabled),
      role: ROLES.includes(raw.role as Role) ? (raw.role as Role) : "backup",
      installDir: (raw.installDir || process.cwd()).toString(),
      label: (raw.label || nodeId()).toString().slice(0, 60),
    };
  } catch {
    return { enabled: false, role: "backup", installDir: process.cwd(), label: nodeId() };
  }
}

export async function writeConfig(patch: Partial<ClusterConfig>): Promise<ClusterConfig> {
  const cur = await readConfig();
  const next: ClusterConfig = {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    role: ROLES.includes(patch.role as Role) ? (patch.role as Role) : cur.role,
    installDir: (patch.installDir ?? cur.installDir).toString().trim() || process.cwd(),
    label: (patch.label ?? cur.label).toString().trim().slice(0, 60) || nodeId(),
  };
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function readLease(): Promise<Lease | null> {
  try {
    return JSON.parse(await fs.readFile(leaseFile(), "utf8")) as Lease;
  } catch {
    return null;
  }
}
async function writeLease(l: Lease): Promise<void> {
  await fs.mkdir(clusterDir(), { recursive: true });
  await fs.writeFile(leaseFile(), JSON.stringify(l, null, 2), "utf8");
}

async function readNodes(): Promise<NodeInfo[]> {
  const files = await fs.readdir(nodesDir()).catch(() => [] as string[]);
  const nodes: NodeInfo[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      nodes.push(JSON.parse(await fs.readFile(path.join(nodesDir(), f), "utf8")) as NodeInfo);
    } catch {
      /* skip corrupt */
    }
  }
  return nodes;
}

async function writeHeartbeat(cfg: ClusterConfig, isMaster: boolean): Promise<void> {
  const info: NodeInfo = {
    host: nodeId(),
    role: cfg.role,
    installDir: cfg.installDir,
    label: cfg.label,
    platform: process.platform,
    ts: Date.now(),
    isMaster,
  };
  await fs.mkdir(nodesDir(), { recursive: true });
  await fs.writeFile(nodeFile(nodeId()), JSON.stringify(info, null, 2), "utf8");
}

/** Decide whether this node holds/gets the master lease, renewing as needed. */
async function elect(cfg: ClusterConfig): Promise<boolean> {
  if (cfg.role === "workstation") return false;
  const me = nodeId();
  const now = Date.now();
  const lease = await readLease();
  const valid = lease !== null && lease.expiresAt > now;

  if (valid && lease!.holder === me) {
    await writeLease({ holder: me, role: cfg.role, renewedAt: now, expiresAt: now + LEASE_TTL_MS, term: lease!.term });
    return true;
  }
  if (valid && lease!.holder !== me) {
    // A live primary reclaims the lease from a backup that took over while it was down.
    if (cfg.role === "primary" && lease!.role !== "primary") {
      await writeLease({ holder: me, role: cfg.role, renewedAt: now, expiresAt: now + LEASE_TTL_MS, term: lease!.term + 1 });
      return true;
    }
    return false; // respect a valid lease held by someone else
  }
  // Lease is free or expired → claim it. Backups defer to a live primary first.
  if (cfg.role === "backup") {
    const nodes = await readNodes();
    const livePrimaryElsewhere = nodes.some((n) => n.role === "primary" && n.host !== me && now - n.ts < NODE_STALE_MS);
    if (livePrimaryElsewhere) return false;
  }
  await writeLease({ holder: me, role: cfg.role, renewedAt: now, expiresAt: now + LEASE_TTL_MS, term: (lease?.term ?? 0) + 1 });
  return true;
}

/**
 * Called every scheduler tick. Returns whether this machine should run
 * master-only duties. Clustering off (or vault unreachable) → behave as a lone
 * machine so nothing silently stops. Heartbeat + election happen as a side effect.
 */
export async function clusterTick(): Promise<boolean> {
  const cfg = await readConfig();
  if (!cfg.enabled) return true;
  if (!(await vaultAvailable())) return cfg.role === "primary"; // vault outage: only the primary keeps firing
  try {
    const isMaster = await elect(cfg);
    await writeHeartbeat(cfg, isMaster);
    return isMaster;
  } catch {
    return false; // coordination error → be conservative, don't double-fire
  }
}

// ─── read-only status + manual actions for the UI ───
export interface NodeView extends NodeInfo {
  online: boolean;
  self: boolean;
}

export async function clusterStatus() {
  const cfg = await readConfig();
  const now = Date.now();
  const lease = cfg.enabled ? await readLease() : null;
  const master = lease && lease.expiresAt > now ? lease.holder : null;
  const nodes: NodeView[] = (cfg.enabled ? await readNodes() : [])
    .map((n) => ({ ...n, online: now - n.ts < NODE_STALE_MS, self: n.host === nodeId() }))
    .sort((a, b) => a.host.localeCompare(b.host));
  return {
    self: nodeId(),
    config: cfg,
    master,
    masterIsSelf: master === nodeId(),
    leaseExpiresAt: lease?.expiresAt ?? 0,
    vaultOk: await vaultAvailable(),
    nodes,
  };
}

/** Force this machine to become master now (respects nothing — explicit operator action). */
export async function claimMaster(): Promise<void> {
  const cfg = await readConfig();
  if (cfg.role === "workstation") await writeConfig({ role: "backup" }); // can't be master as a workstation
  const now = Date.now();
  const lease = await readLease();
  await writeLease({ holder: nodeId(), role: cfg.role === "workstation" ? "backup" : cfg.role, renewedAt: now, expiresAt: now + LEASE_TTL_MS, term: (lease?.term ?? 0) + 1 });
  await writeHeartbeat(await readConfig(), true);
}

/** Step down if this machine holds the lease (lets a backup take over). */
export async function releaseMaster(): Promise<void> {
  const lease = await readLease();
  if (lease && lease.holder === nodeId()) {
    await writeLease({ ...lease, expiresAt: Date.now() - 1 });
  }
}

/** Forget a node's heartbeat (e.g. a machine that's gone for good). */
export async function forgetNode(host: string): Promise<void> {
  await fs.unlink(nodeFile(host)).catch(() => {});
}
