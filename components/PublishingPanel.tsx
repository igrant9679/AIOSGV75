"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck, IconTrash } from "./icons";
import { useMission } from "./store";

interface WpStatus {
  configured: boolean;
  source: "stored" | "env" | null;
  site: string;
  username: string;
  stored: boolean;
}

const inputCls =
  "h-10 w-full rounded-lg border border-line bg-panel-2 px-3 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

export default function PublishingPanel() {
  const { addEvent } = useMission();
  const [wp, setWp] = useState<WpStatus | null>(null);
  const [site, setSite] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/publish");
      if (res.ok) {
        const j = (await res.json()) as { wordpress: WpStatus };
        setWp(j.wordpress);
        setSite((s) => s || j.wordpress.site);
        setUsername((u) => u || j.wordpress.username);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setErr("");
    setSaving(true);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, username, appPassword }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "save failed");
        return;
      }
      addEvent("SETTINGS", "WordPress connection saved", "lime");
      setAppPassword("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await fetch("/api/publish", { method: "DELETE" });
      addEvent("SETTINGS", "WordPress connection removed", "rose");
      setSite("");
      setUsername("");
      setAppPassword("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Publishing — WordPress"
      delay={0.04}
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <StatusOrb accent={wp?.configured ? "lime" : "rose"} pulsing={false} size={7} />
          {wp?.configured ? (wp.source === "env" ? "from .env" : "connected") : "not connected"}
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-5">
        {err && (
          <div role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-xs text-neon-rose">
            {err}
          </div>
        )}
        <p className="text-xs leading-5 text-ink-faint">
          Connect a WordPress site so the <span className="font-mono text-neon-violet">Content</span> pipeline can push
          drafts to it. Create an <span className="font-mono">Application Password</span> in WordPress under{" "}
          <span className="font-mono">Users → Profile → Application Passwords</span> (needs WordPress 5.6+). Stored locally
          in <span className="font-mono">data/publish.json</span>; the password never leaves this machine except to your site.
        </p>

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
            <span className="normal-case text-ink-faint">{wp?.stored ? "(stored — enter a new one to replace)" : "(xxxx xxxx xxxx xxxx xxxx xxxx)"}</span>
          </label>
          <input
            id="wp-pass"
            type="password"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder={wp?.stored ? "•••••••• stored" : "application password"}
            className={inputCls}
            autoComplete="off"
          />
        </div>
        <div className="flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={save}
            disabled={saving || !site.trim() || !username.trim() || !appPassword.trim()}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-lime-600 to-neon-lime px-4 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            <IconCheck width={14} height={14} /> Save connection
          </motion.button>
          {wp?.stored && (
            <button
              onClick={clear}
              disabled={saving}
              aria-label="Remove WordPress connection"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-line text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
            >
              <IconTrash width={14} height={14} />
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
