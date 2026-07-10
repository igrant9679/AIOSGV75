"use client";

import { useEffect, useState } from "react";

interface Blip {
  x: number;
  y: number;
  delay: number;
}

/** Decorative rotating radar with randomized blips (seeded client-side to stay hydration-safe). */
export default function RadarSweep({ size = 220 }: { size?: number }) {
  const [blips, setBlips] = useState<Blip[]>([]);

  useEffect(() => {
    setBlips(
      Array.from({ length: 7 }, () => {
        const angle = Math.random() * Math.PI * 2;
        const radius = 12 + Math.random() * 34;
        return {
          x: 50 + radius * Math.cos(angle),
          y: 50 + radius * Math.sin(angle),
          delay: Math.random() * 4,
        };
      }),
    );
  }, []);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {[48, 36, 24, 12].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(34,211,238,0.15)" strokeWidth="0.5" />
        ))}
        <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(34,211,238,0.1)" strokeWidth="0.5" />
        <line x1="50" y1="2" x2="50" y2="98" stroke="rgba(34,211,238,0.1)" strokeWidth="0.5" />
        {blips.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y} r="1.2" fill="#22d3ee">
            <animate
              attributeName="opacity"
              values="0;1;0"
              dur="4s"
              begin={`${b.delay}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}
      </svg>
      {/* sweep */}
      <div
        className="animate-radar absolute inset-[2%] rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, rgba(34,211,238,0.35) 0deg, rgba(34,211,238,0.06) 55deg, transparent 70deg)",
          maskImage: "radial-gradient(circle, black 96%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: "inset 0 0 40px rgba(34,211,238,0.08)" }}
      />
    </div>
  );
}
