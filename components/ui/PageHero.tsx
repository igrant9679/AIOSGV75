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
      className="mb-4 px-1"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="shrink-0 font-display text-xl font-bold tracking-[0.12em]" style={{ color: ACCENT }}>
            {meta.title.toUpperCase()}
          </h2>
          <p className="truncate font-mono text-[10px] tracking-[0.24em] text-ink-faint">{meta.tagline.toUpperCase()}</p>
        </div>
        <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.24em] text-ink-faint sm:block">
          DECK <span style={{ color: ACCENT }}>//</span> {meta.title.toUpperCase()}
        </span>
      </div>
      <div
        className="relative mt-2 h-px w-full overflow-hidden rounded-full"
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
