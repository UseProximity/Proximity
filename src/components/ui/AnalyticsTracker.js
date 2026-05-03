"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { trackEvent, trackSessionEnd } from "@/utils/analytics";

export default function AnalyticsTracker() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  // Track page views
  useEffect(() => {
    trackEvent("page_view", { path: pathname }, userId);
  }, [pathname, userId]);

  // Track session end on tab close / navigate away
  useEffect(() => {
    const handleUnload = () => trackSessionEnd(userId);
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [userId]);

  return null;
}
