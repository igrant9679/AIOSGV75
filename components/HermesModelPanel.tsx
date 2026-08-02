"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { useMission } from "./store";

interface ChainEntry {
  provider: string;
  model: string;
}
interface NousModel {
  id: string;
  inPerM: number;
  outPerM: number;
  free: boolean;
}
interface ConfigState {
  primary: ChainEntry | null;
  fallbacks: ChainEntry[];
  configPath: string;
  exists: boolean;
  models: NousModel[];
}

const selectCls =
  "w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-ink-faint cursor-pointer";

function priceLabel(m: NousModel): string {
  if (m.free) return "FREE";
  return `$${m.inPerM.toFixed(2)}/$${m.outPerM.toFixed(2)} per M`;
}

export default function HermesModelPanel() {
  const { addEvent } = useMission();
  const [cfg, setCfg] = useState<ConfigState | null>(null);
  const [primary, setPrimary] = useState("");
  const [fallback, setFallback] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hermes/config");
      if (!res.ok) return;
      const j = (await res.json()) as ConfigState;
      setCfg(j);
      setPrimary(j.primary?.model ?? "");
      setFallback(j.fallbacks[0]?.model ?? "");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setErr("");
    setNote("");
    setSaving(true);
    try {
      const res = await fetch("/api/hermes/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary,
          fallbacks: fallback ? [{ provider: "nous", model: fallback }] : [],
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErr(j.error ?? "could not save");
      } else {
        setNote("Saved — Hermes confirmed the new chain.");
        addEvent("HERMES", `model → ${primary}${fallback ? ` (fallback ${fallback})` : ""}`, "amber");
        await load();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const dirty = cfg !== null && (primary !== (cfg.primary?.model ?? "") || fallback !== (cfg.fallbacks[0]?.model ?? ""));
  const models = cfg?.models ?? [];
  const chosen = models.find((m) => m.id === primary);

  return (
    <Panel
      title="Model & Fallback"
      right={
        <span className="font-mono text-[10px] text-ink-faint">
          {cfg?.exists ? "config.yaml · this machine only" : "no Hermes config here"}
        </span>
      }
    >
      {!cfg?.exists ? (
        <p className="text-sm text-ink-dim">
          No Hermes config found at <code className="font-mono text-xs">{cfg?.configPath}</code>. Hermes isn&apos;t
          installed on this machine, so there&apos;s nothing to configure here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm">
            <StatusOrb accent={chosen && !chosen.free ? "amber" : "lime"} />
            <span className="text-ink-dim">Now:</span>
            <span className="font-mono text-xs text-ink">{cfg.primary?.model ?? "—"}</span>
            {cfg.fallbacks.length > 0 && (
              <>
                <span className="text-ink-faint">→</span>
                <span className="font-mono text-xs text-ink-dim">{cfg.fallbacks.map((f) => f.model).join(" → ")}</span>
              </>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint" htmlFor="hermes-primary">
                Primary
              </label>
              <select
                id="hermes-primary"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className={selectCls}
              >
                {!models.some((m) => m.id === primary) && primary && <option value={primary}>{primary}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} — {priceLabel(m)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint" htmlFor="hermes-fallback">
                Fallback <span className="normal-case text-ink-faint">(on rate-limit / credit exhaustion)</span>
              </label>
              <select
                id="hermes-fallback"
                value={fallback}
                onChange={(e) => setFallback(e.target.value)}
                className={selectCls}
              >
                <option value="">— none —</option>
                {models
                  .filter((m) => m.id !== primary)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} — {priceLabel(m)}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {chosen && !chosen.free && (
            <p className="text-xs text-amber-400">
              {chosen.id} is metered — {priceLabel(chosen)} against your prepaid Nous credits. A model ending{" "}
              <code className="font-mono">:free</code> costs nothing.
            </p>
          )}
          {models.length === 0 && (
            <p className="text-xs text-ink-faint">
              Couldn&apos;t reach Nous Portal for the model list (its token is short-lived and refreshed by Hermes). The
              current value is still shown and saveable.
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty || !primary}
              className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-ink transition hover:border-ink-faint disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save chain"}
            </button>
            {err && <span className="text-xs text-rose-400">{err}</span>}
            {note && <span className="text-xs text-lime-400">{note}</span>}
          </div>

          <p className="text-[11px] text-ink-faint">
            Writes <code className="font-mono">{cfg.configPath}</code>, keeping its inline comments (unlike{" "}
            <code className="font-mono">hermes config set</code>). Backed up to{" "}
            <code className="font-mono">.bak-mc</code> and verified against the CLI — a config Hermes can&apos;t read is
            rolled back automatically. Other machines have their own Hermes and are unaffected.
          </p>
        </div>
      )}
    </Panel>
  );
}
