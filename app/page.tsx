"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import HubSection from "@/components/HubSection";
import { readAppearance } from "@/components/useAppearance";

const STARTED_KEY = "mc-start-page-applied";

/** The Hub: one box for everything (components/HubSection.tsx). The old Overview is at /overview. */
export default function HubPage() {
  const router = useRouter();

  // Appearance → Start page: on the first load of a browser tab, jump to the
  // chosen page. Only once per tab, so clicking Hub later still works.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STARTED_KEY)) return;
      sessionStorage.setItem(STARTED_KEY, "1");
      const start = readAppearance().startPage;
      if (start && start !== "/") router.replace(start);
    } catch {
      /* storage blocked — stay on the Hub */
    }
  }, [router]);

  return <HubSection />;
}
