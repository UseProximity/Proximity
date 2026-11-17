"use client";

/*
 * Sends the marketing session beacon (POST /api/marketing/session) after the
 * page loads and on every route change. The server owns everything else:
 * classifying the visit, the 30-minute HttpOnly cookie, touchpoints and the
 * guides / hub visit outcomes. Renders nothing.
 *
 * Only pathname changes trigger a beacon. Query-only changes (opening a
 * listing modal with ?listing=) are not a new page, and the current query
 * string is read at send time so the landing URL's campaign tags go along.
 *
 * The first beacon carries document.referrer (where the visitor came from).
 * Later ones carry our own previous URL, so an expired session restarted by
 * in-app navigation is classified as direct, not as the original referrer.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function MarketingBeacon() {
  const pathname = usePathname();
  const previous = useRef(null);

  useEffect(() => {
    if (!pathname) return;
    const referrer = previous.current === null ? document.referrer : `${window.location.origin}${previous.current}`;
    previous.current = pathname;
    try {
      fetch("/api/marketing/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, search: window.location.search, referrer }),
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    } catch {
      // A beacon must never affect the page.
    }
  }, [pathname]);

  return null;
}
