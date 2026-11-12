import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import http from "http";
import path from "path";

/**
 * Phone access: the whole app on the LAN listener (port 3101, the one the LAN link already
 * opened in the firewall), behind a PIN. Off by default; per machine (each machine serves
 * its own app). Anything that isn't /peer/* on that port lands here: a sign-in page, then
 * every request is passed through to the app on 127.0.0.1:3000 (streaming included).
 *
 * Signed-in phones get a random token in an HttpOnly cookie; only its hash is stored.
 * Five wrong PINs from one address lock it out for 15 minutes.
 */
const FILE = path.join(process.cwd(), "data", "phone-access.json");
const APP_PORT = Number(process.env.PORT || 3000);
const COOKIE = "mc_phone";
const SESSION_DAYS = 30;

interface PhoneSession {
  hash: string;
  created: number;
  lastSeen: number;
  agent: string;
}
interface Store {
  enabled: boolean;
  salt?: string;
  pinHash?: string;
  sessions: PhoneSession[];
}

let cache: { at: number; s: Store } | null = null;
function readStore(): Store {
  if (cache && Date.now() - cache.at < 3_000) return cache.s;
  let s: Store = { enabled: false, sessions: [] };
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<Store>;
    s = { enabled: Boolean(j.enabled), salt: j.salt, pinHash: j.pinHash, sessions: Array.isArray(j.sessions) ? j.sessions : [] };
  } catch {
    /* default: off */
  }
  cache = { at: Date.now(), s };
  return s;
}
async function writeStore(s: Store): Promise<void> {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(s, null, 1), "utf8");
  await fsp.rename(tmp, FILE);
  cache = { at: Date.now(), s };
}

const hashPin = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString("hex");
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

// ─── settings (for the app's own API) ───

export function phoneStatus() {
  const s = readStore();
  return {
    enabled: s.enabled,
    pinSet: Boolean(s.pinHash),
    devices: s.sessions.map((x) => ({ id: x.hash.slice(0, 10), created: x.created, lastSeen: x.lastSeen, agent: x.agent })),
  };
}

export async function setPhoneAccess(opts: { enabled?: boolean; pin?: string; signOutAll?: boolean; removeDevice?: string }): Promise<ReturnType<typeof phoneStatus>> {
  const s = { ...readStore() };
  if (typeof opts.pin === "string") {
    const pin = opts.pin.trim();
    if (!/^\S{6,64}$/.test(pin)) throw Object.assign(new Error("Use a PIN of at least 6 characters (no spaces)."), { status: 400 });
    s.salt = randomBytes(16).toString("hex");
    s.pinHash = hashPin(pin, s.salt);
    s.sessions = []; // a new PIN signs every phone out
  }
  if (opts.signOutAll) s.sessions = [];
  if (opts.removeDevice) s.sessions = s.sessions.filter((x) => !x.hash.startsWith(opts.removeDevice!));
  if (typeof opts.enabled === "boolean") {
    if (opts.enabled && !s.pinHash) throw Object.assign(new Error("Set a PIN first."), { status: 400 });
    s.enabled = opts.enabled;
  }
  await writeStore(s);
  return phoneStatus();
}

// ─── the LAN side ───

const failures = new Map<string, { n: number; since: number; until: number }>();

function cookieToken(req: http.IncomingMessage): string | null {
  const c = String(req.headers.cookie ?? "");
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`));
  return m ? m[1] : null;
}

function signedIn(req: http.IncomingMessage, s: Store): PhoneSession | null {
  const t = cookieToken(req);
  if (!t) return null;
  const h = hashToken(t);
  const hit = s.sessions.find((x) => x.hash === h && Date.now() - x.created < SESSION_DAYS * 86_400_000);
  return hit ?? null;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function page(res: http.ServerResponse, status: number, title: string, body: string) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f6f8;color:#14202b;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.c{background:#fff;border-radius:16px;padding:24px;max-width:360px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 4px}p{color:#56636f;font-size:14px;line-height:1.5}
input{width:100%;box-sizing:border-box;font-size:20px;padding:12px;border:1px solid #cdd5dc;border-radius:10px;margin:8px 0 12px;letter-spacing:.15em}
button{width:100%;font-size:16px;font-weight:600;padding:12px;border:0;border-radius:10px;background:#00897b;color:#fff}.e{color:#b23a55}</style></head>
<body><div class="c">${body}</div></body></html>`);
}

function loginPage(res: http.ServerResponse, msg = "", status = 200) {
  page(
    res,
    status,
    "Sign in",
    `<h1>Phone access</h1><p>Enter the PIN set on this computer (Settings → Phone access).</p>${msg ? `<p class="e">${esc(msg)}</p>` : ""}
<form method="post" action="/__mc/login"><input name="pin" type="password" inputmode="text" autocomplete="current-password" autofocus required minlength="6"><button type="submit">Sign in</button></form>`,
  );
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  let s = "";
  for await (const c of req) {
    s += (c as Buffer).toString("utf8");
    if (s.length > 4096) break;
  }
  return new URLSearchParams(s);
}

function clientIp(req: http.IncomingMessage): string {
  return String(req.socket.remoteAddress ?? "?");
}

/** Everything on the LAN port that isn't a /peer/ call. */
export async function handlePhone(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const s = readStore();
  const url = new URL(req.url ?? "/", "http://phone");
  if (!s.enabled || !s.pinHash) {
    return page(res, 404, "Phone access is off", `<h1>Phone access is off</h1><p>Turn it on in the app on this computer: Settings → Phone access.</p>`);
  }

  if (url.pathname === "/__mc/login") {
    if (req.method !== "POST") return loginPage(res);
    const ip = clientIp(req);
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return loginPage(res, "Too many wrong PINs - try again in a few minutes.", 429);
    const pin = (await readForm(req)).get("pin") ?? "";
    const ok = s.salt && s.pinHash && timingSafeEqual(Buffer.from(hashPin(pin, s.salt), "hex"), Buffer.from(s.pinHash, "hex"));
    if (!ok) {
      const fresh = !f || Date.now() - f.since > 15 * 60_000;
      const n = fresh ? 1 : f.n + 1;
      failures.set(ip, { n, since: fresh ? Date.now() : f.since, until: n >= 5 ? Date.now() + 15 * 60_000 : 0 });
      return loginPage(res, n >= 5 ? "Too many wrong PINs - try again in 15 minutes." : "That PIN isn't right.", 401);
    }
    failures.delete(ip);
    const token = randomBytes(32).toString("base64url");
    const fresh = { ...readStore() };
    fresh.sessions = [...fresh.sessions.filter((x) => Date.now() - x.created < SESSION_DAYS * 86_400_000), { hash: hashToken(token), created: Date.now(), lastSeen: Date.now(), agent: String(req.headers["user-agent"] ?? "").slice(0, 120) }].slice(-20);
    await writeStore(fresh);
    res.writeHead(303, {
      "Set-Cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`,
      Location: "/command",
      "Cache-Control": "no-store",
    });
    return void res.end();
  }
  if (url.pathname === "/__mc/logout") {
    const t = cookieToken(req);
    if (t) {
      const h = hashToken(t);
      await writeStore({ ...readStore(), sessions: readStore().sessions.filter((x) => x.hash !== h) });
    }
    res.writeHead(303, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0`, Location: "/__mc/login" });
    return void res.end();
  }

  const who = signedIn(req, s);
  if (!who) {
    if (req.method === "GET" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/_next/")) {
      res.writeHead(303, { Location: "/__mc/login", "Cache-Control": "no-store" });
      return void res.end();
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    return void res.end(JSON.stringify({ error: "Sign in first (phone access)." }));
  }
  if (Date.now() - who.lastSeen > 10 * 60_000) {
    who.lastSeen = Date.now();
    void writeStore({ ...s }).catch(() => {});
  }

  // pass through to the app on this machine, streaming both ways
  // the phone's own Host is kept, so anything the app builds from it points back at this port
  const headers: http.OutgoingHttpHeaders = { ...req.headers, "x-forwarded-for": clientIp(req), "x-mc-phone": "1" };
  delete headers["x-mc-peer-key"];
  // Every stream gets an error handler: an unhandled stream error would end the whole server.
  const up = http.request({ host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers }, (r) => {
    r.on("error", () => res.destroy());
    const out = { ...r.headers };
    const loc = out.location;
    if (typeof loc === "string") out.location = loc.replace(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i, "");
    try {
      res.writeHead(r.statusCode ?? 502, out);
    } catch {
      r.destroy();
      return void res.destroy();
    }
    r.pipe(res);
  });
  up.on("error", (e) => {
    if (res.destroyed) return;
    if (!res.headersSent) page(res, 502, "Not running", `<h1>The app isn't answering</h1><p>${esc(e.message)}</p>`);
    else res.end();
  });
  // the phone hung up (closed the tab, cancelled a prefetch): stop the request to the app too
  req.on("error", () => up.destroy());
  res.on("error", () => up.destroy());
  res.on("close", () => {
    if (!res.writableFinished) up.destroy();
  });
  req.pipe(up);
}
