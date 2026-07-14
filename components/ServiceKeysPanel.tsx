"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck, IconTrash } from "./icons";
import { useMission } from "./store";

interface ServiceStatus {
  id: string;
  label: string;
  blurb: string;
  categories: ("image" | "voice" | "video")[];
  envVar: string;
  keyHint: string;
  keyPrefix: string;
  source: "stored" | "env" | null;
  configured: boolean;
  stored: boolean;
}

const inputCls =
  "h-10 w-full rounded-lg border border-line bg-panel-2 px-3 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

const CAT_LABEL: Record<string, string> = { image: "Image", voice: "Voice", video: "Video" };

export default function ServiceKeysPanel() {
  const { addEvent } = useMission();
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/services");
      if (res.ok) setServices(((await res.json()) as { services: ServiceStatus[] }).services ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (id: string, label: string) => {
    const apiKey = (drafts[id] ?? "").trim();
    if (!apiKey) return;
    setErr("");
    setSaving(id);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, apiKey }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "save failed");
        return;
      }
      addEvent("SETTINGS", `${label} key saved`, "lime");
      setDrafts((d) => ({ ...d, [id]: "" }));
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const clear = async (id: string, label: string) => {
    setSaving(id);
    try {
      await fetch(`/api/services?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      addEvent("SETTINGS", `${label} key removed`, "rose");
      await load();
    } finally {
      setSaving(null);
    }
  };

  return (
    <Panel
      title="API Keys — Creative & Integrations"
      delay={0.03}
      right={<span className="font-mono text-[10px] text-ink-faint">stored locally in data/services.json</span>}
    >
      <div className="flex flex-col gap-3 p-5">
        {err && (
          <div role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-xs text-neon-rose">
            {err}
          </div>
        )}
        <p className="text-xs leading-5 text-ink-faint">
          Keys for the paid providers behind the <span className="font-mono text-neon-cyan">Studio</span> (image · voice ·
          video). Each stays on this machine and is never sent anywhere but the provider you enter it for. A key set in{" "}
          <span className="font-mono">.env.local</span> is used automatically as a fallback.
        </p>

        {services.map((s) => (
          <div key={s.id} className="rounded-xl border border-line bg-white/[0.02] p-4">
            <div className="mb-2.5 flex items-center gap-3">
              <StatusOrb accent={s.configured ? "lime" : "rose"} pulsing={false} size={8} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-ink">{s.label}</p>
                  {s.categories.map((c) => (
                    <span key={c} className="rounded bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-neon-cyan">
                      {CAT_LABEL[c] ?? c}
                    </span>
                  ))}
                  {s.source && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
                      {s.source === "env" ? "from .env" : "configured"}
                    </span>
                  )}
                </div>
                <p className="truncate text-[11px] leading-4 text-ink-faint">{s.blurb}</p>
              </div>
            </div>

            <label className={labelCls} htmlFor={`svc-${s.id}`}>
              API KEY{" "}
              <span className="normal-case text-ink-faint">
                (get one at {s.keyHint}
                {s.source === "env" ? ` · currently using ${s.envVar}` : ""})
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`svc-${s.id}`}
                type="password"
                autoComplete="off"
                value={drafts[s.id] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save(s.id, s.label);
                }}
                placeholder={s.stored ? "•••••••• stored — enter a new key to replace" : s.keyPrefix}
                className={inputCls}
              />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => save(s.id, s.label)}
                disabled={saving === s.id || !(drafts[s.id] ?? "").trim()}
                aria-label={`Save ${s.label} key`}
                className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-lime-600 to-neon-lime px-4 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconCheck width={14} height={14} /> Save
              </motion.button>
              {s.stored && (
                <button
                  onClick={() => clear(s.id, s.label)}
                  disabled={saving === s.id}
                  aria-label={`Remove stored ${s.label} key`}
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
                >
                  <IconTrash width={14} height={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
