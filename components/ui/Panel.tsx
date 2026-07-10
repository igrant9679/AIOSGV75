"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export default function Panel({
  title,
  right,
  children,
  className = "",
  delay = 0,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`panel relative overflow-hidden ${className}`}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {right}
        </header>
      )}
      {children}
    </motion.section>
  );
}
