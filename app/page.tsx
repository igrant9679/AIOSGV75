"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import OverviewSection from "@/components/OverviewSection";
import { readAppearance } from "@/components/useAppearance";

const STARTED_KEY = "mc-start-page-applied";

export default function OverviewPage() {
  const router = useRouter();

  // Appearance → Start page: on the first load of a browser tab, jump to the
  // chosen page. Only once per tab, so clicking Overview later still works.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STARTED_KEY)) return;
      sessionStorage.setItem(STARTED_KEY, "1");
      const start = readAppearance().startPage;
      if (start && start !== "/") router.replace(start);
    } catch {
      /* storage blocked — stay on Overview */
    }
  }, [router]);

  return <OverviewSection />;
}
