"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Accent } from "@/lib/accents";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import { useMission } from "./store";

/**
 * Knowledge-graph visualization: vault notes as nodes, [[wikilinks]] as
 * edges, laid out by a small hand-rolled force simulation on canvas (no
 * graph library — same spirit as the hand-built gauges and radar).
 */

const VAULT_NAME = "IdrisGV75"; // matches Markdown.tsx obsidian:// deep links
const ACCENT_CYCLE: Accent[] = ["cyan", "magenta", "amber", "lime", "violet", "rose"];

interface GNode {
  id: string;
  name: string;
  folder: string;
  deg: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}
interface GEdge {
  s: string;
  t: string;
}

export default function GraphSection() {
  const { vaultOk } = useMission();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [focusFolder, setFocusFolder] = useState<string | null>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);

  // sim state lives in refs so the RAF loop never re-renders React
  const sim = useRef<{ nodes: GNode[]; edges: { a: GNode; b: GNode }[]; alpha: number }>({ nodes: [], edges: [], alpha: 1 });
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<GNode | null>(null);
  const drag = useRef<{ node: GNode | null; panning: boolean; moved: boolean; px: number; py: number }>({
    node: null,
    panning: false,
    moved: false,
    px: 0,
    py: 0,
  });
  const colors = useRef<{ byFolder: Map<string, string>; line: string; ink: string }>({
    byFolder: new Map(),
    line: "rgba(120,130,160,0.25)",
    ink: "#c8d0e0",
  });
  const focusRef = useRef<string | null>(null);
  focusRef.current = focusFolder;
  const wakeRef = useRef<() => void>(() => {});

  const folders = useMemo(() => Array.from(new Set(nodes.map((n) => n.folder))).sort(), [nodes]);

  const resolveColors = useCallback((folderList: string[]) => {
    const css = getComputedStyle(document.documentElement);
    const accents = ACCENT_CYCLE.map((a) => css.getPropertyValue(`--ac-${a}`).trim() || "#22d3ee");
    const byFolder = new Map<string, string>();
    folderList.forEach((f, i) => byFolder.set(f, accents[i % accents.length]));
    colors.current = {
      byFolder,
      line: css.getPropertyValue("--color-line").trim() || "rgba(120,130,160,0.25)",
      ink: css.getPropertyValue("--color-ink").trim() || "#c8d0e0",
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/graph");
      if (!res.ok) return;
      const json = (await res.json()) as { nodes: Omit<GNode, "x" | "y" | "vx" | "vy">[]; edges: GEdge[] };
      const w = wrapRef.current?.clientWidth ?? 900;
      const h = 620;
      const seeded: GNode[] = json.nodes.map((n, i) => {
        const angle = (i / Math.max(1, json.nodes.length)) * Math.PI * 2;
        const r = 120 + (i % 7) * 40;
        return { ...n, x: w / 2 + Math.cos(angle) * r, y: h / 2 + Math.sin(angle) * r, vx: 0, vy: 0 };
      });
      const byId = new Map(seeded.map((n) => [n.id, n]));
      sim.current = {
        nodes: seeded,
        edges: json.edges
          .map((e) => ({ a: byId.get(e.s)!, b: byId.get(e.t)! }))
          .filter((e) => e.a && e.b),
        alpha: 1,
      };
      setNodes(seeded);
      setEdges(json.edges);
    } catch {
      /* vault offline — panel shows the orbs */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    resolveColors(folders);
    const mo = new MutationObserver(() => {
      resolveColors(folders);
      wakeRef.current();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, [folders, resolveColors]);

  // filter changes and refreshes happen in React — nudge the canvas loop awake
  useEffect(() => {
    wakeRef.current();
  }, [focusFolder, nodes]);

  // ── simulation + render loop ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let running = false;
    let lastActive = performance.now();

    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(wrap.clientWidth * dpr);
      if (canvas.width === w && canvas.height === Math.round(620 * dpr)) return;
      canvas.width = w;
      canvas.height = Math.round(620 * dpr);
      canvas.style.width = `${wrap.clientWidth}px`;
      canvas.style.height = "620px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      wake();
    };

    let fallback = 0;

    const tick = () => {
      window.clearTimeout(fallback);
      const { nodes: ns, edges: es } = sim.current;
      const a = sim.current.alpha;
      const focus = focusRef.current;

      if (a > 0.02 && ns.length > 0) {
        // repulsion (O(n²) — fine at vault scale)
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const n1 = ns[i];
            const n2 = ns[j];
            let dx = n1.x - n2.x;
            let dy = n1.y - n2.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              dx = (Math.random() - 0.5) * 2;
              dy = (Math.random() - 0.5) * 2;
              d2 = 4;
            }
            const f = (900 * a) / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            n1.vx += fx;
            n1.vy += fy;
            n2.vx -= fx;
            n2.vy -= fy;
          }
        }
        // springs
        for (const e of es) {
          const dx = e.b.x - e.a.x;
          const dy = e.b.y - e.a.y;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const f = (d - 70) * 0.02 * a;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          e.a.vx += fx;
          e.a.vy += fy;
          e.b.vx -= fx;
          e.b.vy -= fy;
        }
        // centering + integrate
        const cx = wrap.clientWidth / 2;
        const cy = 310;
        for (const n of ns) {
          n.vx += (cx - n.x) * 0.004 * a;
          n.vy += (cy - n.y) * 0.004 * a;
          n.vx *= 0.85;
          n.vy *= 0.85;
          if (n.fx != null) {
            n.x = n.fx;
            n.y = n.fy!;
            n.vx = 0;
            n.vy = 0;
          } else {
            n.x += n.vx;
            n.y += n.vy;
          }
        }
      }
      // decay outside the sim block so an empty graph also settles and sleeps
      if (sim.current.alpha > 0.02) sim.current.alpha *= 0.996;

      // ── draw ──
      const { byFolder, line, ink } = colors.current;
      const v = view.current;
      ctx.clearRect(0, 0, wrap.clientWidth, 620);
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.scale(v.k, v.k);

      const dimmed = (n: GNode) => (focus !== null && n.folder !== focus) || false;
      const hv = hover.current;
      const neighbors = new Set<string>();
      if (hv) {
        neighbors.add(hv.id);
        for (const e of es) {
          if (e.a.id === hv.id) neighbors.add(e.b.id);
          if (e.b.id === hv.id) neighbors.add(e.a.id);
        }
      }

      ctx.lineWidth = 1 / v.k;
      for (const e of es) {
        const dim = dimmed(e.a) || dimmed(e.b) || (hv !== null && !(neighbors.has(e.a.id) && neighbors.has(e.b.id)));
        ctx.strokeStyle = line;
        ctx.globalAlpha = dim ? 0.12 : 0.6;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
      }

      for (const n of ns) {
        const r = 3.5 + Math.min(9, n.deg * 1.1);
        const dim = dimmed(n) || (hv !== null && !neighbors.has(n.id));
        ctx.globalAlpha = dim ? 0.18 : 1;
        ctx.fillStyle = byFolder.get(n.folder) ?? "#22d3ee";
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (!dim && (v.k > 1.2 || n.deg >= 4 || n === hv)) {
          ctx.globalAlpha = n === hv ? 1 : 0.75;
          ctx.fillStyle = ink;
          ctx.font = `${11 / v.k}px ui-monospace, monospace`;
          ctx.fillText(n.name, n.x + r + 3 / v.k, n.y + 3 / v.k);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // Sleep when settled + idle: zero CPU at rest, and screenshots/OS
      // compositors get an idle frame. Any interaction wakes the loop.
      if (sim.current.alpha > 0.02 || performance.now() - lastActive < 1500) {
        schedule();
      } else {
        running = false;
      }
    };

    // rAF is suspended entirely in hidden/occluded tabs — pair every frame
    // request with a timer fallback so the layout still settles off-screen.
    const schedule = () => {
      raf = requestAnimationFrame(tick);
      window.clearTimeout(fallback);
      fallback = window.setTimeout(() => {
        cancelAnimationFrame(raf);
        tick();
      }, 120);
    };

    const wake = () => {
      lastActive = performance.now();
      if (!running) {
        running = true;
        schedule();
      }
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    wake();

    // ── interactions ──
    const toWorld = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const v = view.current;
      return { x: (e.clientX - rect.left - v.x) / v.k, y: (e.clientY - rect.top - v.y) / v.k };
    };
    const nodeAt = (wx: number, wy: number) => {
      let best: GNode | null = null;
      let bestD = 12 / view.current.k;
      for (const n of sim.current.nodes) {
        const d = Math.hypot(n.x - wx, n.y - wy);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    };

    const onDown = (e: MouseEvent) => {
      wake();
      const w = toWorld(e);
      const n = nodeAt(w.x, w.y);
      drag.current = { node: n, panning: !n, moved: false, px: e.clientX, py: e.clientY };
      if (n) sim.current.alpha = Math.max(sim.current.alpha, 0.4);
    };
    const onMove = (e: MouseEvent) => {
      wake();
      const d = drag.current;
      if (d.node) {
        const w = toWorld(e);
        d.node.fx = w.x;
        d.node.fy = w.y;
        d.moved = true;
        sim.current.alpha = Math.max(sim.current.alpha, 0.3);
      } else if (d.panning && (e.buttons & 1) === 1) {
        view.current.x += e.clientX - d.px;
        view.current.y += e.clientY - d.py;
        d.px = e.clientX;
        d.py = e.clientY;
        d.moved = true;
      } else {
        const w = toWorld(e);
        const n = nodeAt(w.x, w.y);
        hover.current = n;
        setHoverName(n ? `${n.id} · ${n.deg} links` : null);
        canvas.style.cursor = n ? "pointer" : "grab";
      }
    };
    const onUp = (e: MouseEvent) => {
      const d = drag.current;
      if (d.node && !d.moved) {
        window.open(
          `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(d.node.id)}`,
          "_self"
        );
      }
      if (d.node) {
        d.node.fx = null;
        d.node.fy = null;
      }
      drag.current = { node: null, panning: false, moved: false, px: e.clientX, py: e.clientY };
    };
    const onWheel = (e: WheelEvent) => {
      wake();
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = view.current;
      const k = Math.min(4, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      v.x = mx - ((mx - v.x) / v.k) * k;
      v.y = my - ((my - v.y) / v.k) * k;
      v.k = k;
    };

    wakeRef.current = wake;
    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
      ro.disconnect();
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [nodes.length]);

  const orphans = nodes.filter((n) => n.deg === 0).length;
  const hub = nodes.reduce<GNode | null>((best, n) => (best === null || n.deg > best.deg ? n : best), null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel title="Notes">
          <div className="p-4">
            <span style={{ color: "var(--ac-cyan)" }}>
              <NumberTicker value={nodes.length} className="text-3xl font-bold" />
            </span>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">NODES IN THE GRAPH</p>
          </div>
        </Panel>
        <Panel title="Links" delay={0.04}>
          <div className="p-4">
            <span style={{ color: "var(--ac-magenta)" }}>
              <NumberTicker value={edges.length} className="text-3xl font-bold" />
            </span>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">RESOLVED WIKILINKS</p>
          </div>
        </Panel>
        <Panel title="Orphans" delay={0.08}>
          <div className="p-4">
            <span style={{ color: orphans > 0 ? "var(--ac-amber)" : "var(--ac-lime)" }}>
              <NumberTicker value={orphans} className="text-3xl font-bold" />
            </span>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">NOTES WITH NO LINKS</p>
          </div>
        </Panel>
        <Panel title="Top Hub" delay={0.12}>
          <div className="p-4">
            <p className="truncate text-xl font-bold" style={{ color: "var(--ac-violet)" }}>
              {hub?.name ?? "—"}
            </p>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
              {hub ? `${hub.deg} CONNECTIONS` : "VAULT EMPTY"}
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        title="Knowledge Graph"
        right={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ink-faint">{hoverName ?? "drag · scroll to zoom · click opens Obsidian"}</span>
            <button
              onClick={() => {
                view.current = { x: 0, y: 0, k: 1 };
                load();
              }}
              className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
            >
              ↻ refresh
            </button>
          </span>
        }
        delay={0.1}
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {folders.map((f) => (
              <button
                key={f}
                onClick={() => setFocusFolder(focusFolder === f ? null : f)}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] transition-colors"
                style={{
                  borderColor: focusFolder === f ? (colors.current.byFolder.get(f) ?? "var(--color-line)") : "var(--color-line)",
                  color: focusFolder === f ? (colors.current.byFolder.get(f) ?? "inherit") : "var(--color-ink-faint)",
                  opacity: focusFolder !== null && focusFolder !== f ? 0.45 : 1,
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: colors.current.byFolder.get(f) ?? "#22d3ee" }} />
                {f}
              </button>
            ))}
          </div>
          {/* canvas must be unconditionally mounted — a conditional sibling made
              React remount it when vaultOk flipped, orphaning the sim loop */}
          <div ref={wrapRef} className="relative overflow-hidden rounded-xl border border-line bg-white/[0.015]">
            <canvas ref={canvasRef} aria-label="Knowledge graph of vault notes" />
            {!vaultOk && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
                Vault offline — the graph reads your Obsidian notes.
              </p>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
