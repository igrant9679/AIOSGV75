"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck, IconTrash } from "./icons";
import { useMission } from "./store";

interface TargetStatus {
  configured: boolean;
  source: "stored" | "env" | null;
  stored: boolean;
  site?: string;
  username?: string;
  collectionId?: string;
  bodyField?: string;
}

interface PubStatus {
  wordpress: TargetStatus;
  ghost: TargetStatus;
  webflow: TargetStatus;
}

const inputCls =
  "h-10 w-full rounded-lg border border-line bg-panel-2 px-3 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

function TargetHeader({ label, st }: { label: string; st?: TargetStatus }) {
  return (
    <div className="flex items-center justify-between">
      <p className="font-mono text-[11px] font-bold tracking-[0.18em] text-ink">{label}</p>
      <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
        <StatusOrb accent={st?.configured ? "lime" : "rose"} pulsing={false} size={7} />
        {st?.configured ? (st.source === "env" ? "from .env" : "connected") : "not connected"}
      </span>
    </div>
  );
}

function SaveRow({
  onSave,
  onClear,
  canSave,
  stored,
  saving,
  clearLabel,
}: {
  onSave: () => void;
  onClear: () => void;
  canSave: boolean;
  stored: boolean;
  saving: boolean;
  clearLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onSave}
        disabled={saving || !canSave}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-lime-600 to-neon-lime px-4 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
      >
        <IconCheck width={14} height={14} /> Save connection
      </motion.button>
      {stored && (
        <button
          onClick={onClear}
          disabled={saving}
          aria-label={clearLabel}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-line text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
        >
          <IconTrash width={14} height={14} />
        </button>
      )}
    </div>
  );
}

export default function PublishingPanel() {
  const { addEvent } = useMission();
  const [status, setStatus] = useState<PubStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // wordpress
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  // ghost
  const [ghostSite, setGhostSite] = useState("");
  const [ghostKey, setGhostKey] = useState("");
  // webflow
  const [wfToken, setWfToken] = useState("");
  const [wfCollection, setWfCollection] = useState("");
  const [wfBodyField, setWfBodyField] = useState("post-body");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/publish");
      if (res.ok) {
        const j = (await res.json()) as PubStatus;
        setStatus(j);
        setSite((s) => s || j.wordpress.site || "");
        setUsername((u) => u || j.wordpress.username || "");
        setGhostSite((s) => s || j.ghost.site || "");
        setWfCollection((c) => c || j.webflow.collectionId || "");
        setWfBodyField((b) => (b === "post-body" ? j.webflow.bodyField || "post-body" : b));
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (target: "wordpress" | "ghost" | "webflow", body: Record<string, string>, doneMsg: string) => {
    setErr("");
    setSaving(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, ...body }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "save failed");
        return false;
      }
      addEvent("SETTINGS", doneMsg, "lime");
      await load();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const clear = async (target: "wordpress" | "ghost" | "webflow", label: string) => {
    setSaving(true);
    try {
      await fetch(`/api/publish?target=${target}`, { method: "DELETE" });
      addEvent("SETTINGS", `${label} connection removed`, "rose");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const section = (children: ReactNode) => (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4">{children}</div>
  );

  return (
    <Panel
      title="Publishing — WordPress · Ghost · Webflow"
      delay={0.04}
      right={
        <span className="font-mono text-[10px] text-ink-faint">
          {status ? `${[status.wordpress, status.ghost, status.webflow].filter((t) => t.configured).length}/3 connected` : "…"}
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        {err && (
          <div role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-xs text-neon-rose">
            {err}
          </div>
        )}
        <p className="text-xs leading-5 text-ink-faint">
          Connect one or more targets and the <span className="font-mono text-neon-violet">Content</span> pipeline can push
          drafts to them. Everything posts as a <span className="text-ink">draft</span> by default — nothing goes live
          unreviewed. Credentials stay local in <span className="font-mono">data/publish.json</span>.
        </p>

        {section(
          <>
            <TargetHeader label="WORDPRESS" st={status?.wordpress} />
            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <div>
                <label className={labelCls} htmlFor="wp-site">SITE URL</label>
                <input id="wp-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://blog.example.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="wp-user">USERNAME</label>
                <input id="wp-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className={inputCls} autoComplete="off" />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="wp-pass">
                APPLICATION PASSWORD{" "}
                <span className="normal-case text-ink-faint">
                  {status?.wordpress.stored ? "(stored — enter a new one to replace)" : "(Users → Profile → Application Passwords, WP 5.6+)"}
                </span>
              </label>
              <input
                id="wp-pass"
                type="password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder={status?.wordpress.stored ? "•••••••• stored" : "application password"}
                className={inputCls}
                autoComplete="off"
              />
            </div>
            <SaveRow
              onSave={async () => {
                if (await save("wordpress", { site, username, appPassword }, "WordPress connection saved")) setAppPassword("");
              }}
              onClear={() => clear("wordpress", "WordPress")}
              canSave={Boolean(site.trim() && username.trim() && appPassword.trim())}
              stored={Boolean(status?.wordpress.stored)}
              saving={saving}
              clearLabel="Remove WordPress connection"
            />
          </>,
        )}

        {section(
          <>
            <TargetHeader label="GHOST" st={status?.ghost} />
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="gh-site">SITE URL</label>
                <input id="gh-site" value={ghostSite} onChange={(e) => setGhostSite(e.target.value)} placeholder="https://yoursite.ghost.io" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="gh-key">
                  ADMIN API KEY{" "}
                  <span className="normal-case text-ink-faint">
                    {status?.ghost.stored ? "(stored — enter a new one to replace)" : "(Settings → Integrations → Add custom → Admin API key, id:secret)"}
                  </span>
                </label>
                <input
                  id="gh-key"
                  type="password"
                  value={ghostKey}
                  onChange={(e) => setGhostKey(e.target.value)}
                  placeholder={status?.ghost.stored ? "•••••••• stored" : "64f…:a1b2c3…"}
                  className={inputCls}
                  autoComplete="off"
                />
              </div>
            </div>
            <SaveRow
              onSave={async () => {
                if (await save("ghost", { site: ghostSite, adminApiKey: ghostKey }, "Ghost connection saved")) setGhostKey("");
              }}
              onClear={() => clear("ghost", "Ghost")}
              canSave={Boolean(ghostSite.trim() && ghostKey.trim())}
              stored={Boolean(status?.ghost.stored)}
              saving={saving}
              clearLabel="Remove Ghost connection"
            />
          </>,
        )}

        {section(
          <>
            <TargetHeader label="WEBFLOW" st={status?.webflow} />
            <div className="grid gap-3 md:grid-cols-[2fr_2fr_1fr]">
              <div>
                <label className={labelCls} htmlFor="wf-token">
                  API TOKEN{" "}
                  <span className="normal-case text-ink-faint">
                    {status?.webflow.stored ? "(stored — enter a new one to replace)" : "(Site settings → Apps & integrations)"}
                  </span>
                </label>
                <input
                  id="wf-token"
                  type="password"
                  value={wfToken}
                  onChange={(e) => setWfToken(e.target.value)}
                  placeholder={status?.webflow.stored ? "•••••••• stored" : "site token"}
                  className={inputCls}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="wf-coll">CMS COLLECTION ID</label>
                <input id="wf-coll" value={wfCollection} onChange={(e) => setWfCollection(e.target.value)} placeholder="580e63fc8c9a982ac9b8b745" className={inputCls} autoComplete="off" />
              </div>
              <div>
                <label className={labelCls} htmlFor="wf-body">BODY FIELD</label>
                <input id="wf-body" value={wfBodyField} onChange={(e) => setWfBodyField(e.target.value)} placeholder="post-body" className={inputCls} autoComplete="off" />
              </div>
            </div>
            <p className="text-[10.5px] leading-4 text-ink-faint">
              Items are created as CMS drafts in that collection — <span className="font-mono">name</span> and{" "}
              <span className="font-mono">slug</span> map automatically; the article HTML lands in the rich-text field named above.
            </p>
            <SaveRow
              onSave={async () => {
                if (await save("webflow", { token: wfToken, collectionId: wfCollection, bodyField: wfBodyField }, "Webflow connection saved")) setWfToken("");
              }}
              onClear={() => clear("webflow", "Webflow")}
              canSave={Boolean(wfToken.trim() && wfCollection.trim())}
              stored={Boolean(status?.webflow.stored)}
              saving={saving}
              clearLabel="Remove Webflow connection"
            />
          </>,
        )}
      </div>
    </Panel>
  );
}
