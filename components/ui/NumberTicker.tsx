"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useSpring, useMotionValueEvent } from "framer-motion";

export default function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 90, damping: 22 });
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  useMotionValueEvent(spring, "change", (v) => {
    if (ref.current) {
      ref.current.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`;
    }
  });

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
