"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { metaForPath } from "@/lib/accents";

/**
 * Slim page-identity strip rendered above every page's content: accent title,
 * tagline, and a scanning hairline in the page's color. Keyed on pathname so
 * it re-animates on navigation. Colors resolve through --page-accent (set by
 * DeckFrame), so dynamic /agent/<id> pages get their registry accent too.
 */
const ACCENT = "var(--page-accent, var(--ac-cyan))";
const GLOW = "color-mix(in srgb, var(--page-accent, var(--ac-cyan)) 55%, transparent)";

export default function PageHero() {
  const pathname = usePathname();
  const meta = metaForPath(pathname);
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="page-hero relative mb-4 overflow-hidden px-1"
    >
      {/* MissionCommand look only: orbit lines and a soft dot field in the page's color, behind the text */}
      <svg aria-hidden className="hero-art pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[46%]" viewBox="0 0 400 80" preserveAspectRatio="xMaxYMid slice">
        <defs>
          <pattern id="hero-dots" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor" />
          </pattern>
          <linearGradient id="hero-fade" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
          <mask id="hero-mask">
            <rect width="400" height="80" fill="url(#hero-fade)" />
          </mask>
        </defs>
        <g mask="url(#hero-mask)">
          <rect width="400" height="80" fill="url(#hero-dots)" opacity="0.16" />
          {[34, 58, 82, 106, 130].map((r, i) => (
            <circle key={r} cx="352" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth={i === 2 ? 1.6 : 1} opacity={0.12 + i * 0.03} />
          ))}
          {/* two "satellites" riding the orbits */}
          <circle cx="302" cy="11" r="4" fill="#f0b43a" opacity="0.9" />
          <circle cx="273" cy="62" r="2.6" fill="currentColor" opacity="0.6" />
        </g>
      </svg>
      <div className="relative flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="label-caps shrink-0 font-display text-xl font-bold tracking-[0.12em]" style={{ color: ACCENT }}>
            {meta.title}
          </h2>
          <p className="label-caps truncate font-mono text-[10px] tracking-[0.24em] text-ink-faint">{meta.tagline}</p>
        </div>
        <span className="hero-crumb label-caps hidden shrink-0 font-mono text-[10px] tracking-[0.24em] text-ink-faint sm:block">
          Deck <span style={{ color: ACCENT }}>//</span> {meta.title}
        </span>
      </div>
      <div
        className="hero-line relative mt-2 h-px w-full overflow-hidden rounded-full"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, transparent 72%)`, opacity: 0.55 }}
      >
        <span
          aria-hidden
          className="hero-scan absolute inset-y-0 left-0 w-28"
          style={{ background: `linear-gradient(90deg, transparent, ${GLOW}, transparent)` }}
        />
      </div>
    </motion.div>
  );
}
