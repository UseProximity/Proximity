"use client";

/*
 * Sends the marketing session beacon (POST /api/marketing/session) after the
 * page loads and on every route change. The server owns everything else:
 * classifying the visit, the 30-minute HttpOnly cookie, touchpoints and the
 * guides / hub visit outcomes. Renders nothing.
 *
 * Only pathname changes trigger a beacon. Query-only changes (opening a
 * listing modal with ?listing=) are not a new page. The first beacon sends
 * the landing URL's query string (captured at load, see LANDING_SEARCH) so
 * its campaign tags go along; later ones send the current query string.
 *
 * The first beacon carries document.referrer (where the visitor came from).
 * Later ones carry our own previous URL, so an expired session restarted by
 * in-app navigation is classified as direct, not as the original referrer.
 */
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/*
 * The landing URL's query string, captured when this module first loads,
 * before any page effect runs. Some pages tidy their URL on mount (browse
 * strips ?src= for its own matchmaking deep links), and the order in which
 * effects run is not something to rely on, so the first beacon uses this
 * snapshot rather than the live location.
 */
const LANDING_SEARCH = typeof window === "undefined" ? "" : window.location.search;

export default function MarketingBeacon() {
  const pathname = usePathname();
  const previous = useRef(null);

  useEffect(() => {
    if (!pathname) return;
    const first = previous.current === null;
    const referrer = first ? document.referrer : `${window.location.origin}${previous.current}`;
    const search = first ? LANDING_SEARCH : window.location.search;
    previous.current = pathname;
    try {
      fetch("/api/marketing/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname, search, referrer }),
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    } catch {
      // A beacon must never affect the page.
    }
  }, [pathname]);

  return null;
}
