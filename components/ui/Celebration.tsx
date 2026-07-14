"use client";

import { useEffect, useRef } from "react";
import type { Accent } from "@/lib/accents";

/**
 * Full-screen confetti burst, fired via `celebrate(accent?)` from anywhere on
 * the client. Mounted once in Shell (canvas is always mounted — rule 13).
 * Respects prefers-reduced-motion (no-op). Bursts hard-stop after 2s of
 * wall-clock time so a hidden tab can't accumulate work.
 */
export function celebrate(accent?: Accent) {
  window.dispatchEvent(new CustomEvent("mc-celebrate", { detail: { accent } }));
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
}

export default function Celebration() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: Particle[] = [];
    let raf = 0;
    let endAt = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const resolvedAccents = (): string[] => {
      const styles = getComputedStyle(document.documentElement);
      return ["--ac-cyan", "--ac-magenta", "--ac-amber", "--ac-lime", "--ac-violet", "--ac-rose"]
        .map((v) => styles.getPropertyValue(v).trim())
        .filter(Boolean);
    };

    const frame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (performance.now() > endAt || particles.length === 0) {
        particles = [];
        return; // burst over — stop the loop entirely
      }
      for (const p of particles) {
        p.vy += 0.16;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, Math.min(1, (endAt - performance.now()) / 900));
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      particles = particles.filter((p) => p.y < canvas.height + 20);
      raf = requestAnimationFrame(frame);
    };

    const onCelebrate = (e: Event) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const accent = (e as CustomEvent<{ accent?: Accent }>).detail?.accent;
      const styles = getComputedStyle(document.documentElement);
      const accentColor = accent ? styles.getPropertyValue(`--ac-${accent}`).trim() : "";
      const palette = accentColor ? [accentColor, ...resolvedAccents()] : resolvedAccents();
      const w = canvas.width;
      const h = canvas.height;
      const fresh: Particle[] = [];
      for (const originX of [w * 0.12, w * 0.88]) {
        const dir = originX < w / 2 ? 1 : -1;
        for (let i = 0; i < 45; i++) {
          fresh.push({
            x: originX,
            y: h * 0.85,
            vx: dir * (1.5 + Math.random() * 5.5) + (Math.random() - 0.5) * 2,
            vy: -(7 + Math.random() * 7),
            size: 4 + Math.random() * 5,
            color: palette[Math.floor(Math.random() * palette.length)],
            rot: Math.random() * Math.PI,
            vr: (Math.random() - 0.5) * 0.3,
          });
        }
      }
      const wasRunning = particles.length > 0;
      particles = particles.concat(fresh);
      endAt = performance.now() + 2000;
      if (!wasRunning) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    };

    window.addEventListener("mc-celebrate", onCelebrate);
    return () => {
      window.removeEventListener("mc-celebrate", onCelebrate);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-[90]" />;
}
