"use client";

import { useEffect, useRef } from "react";

/*
 * Ask before leaving a page with work in flight, and clean up if they go.
 *
 * Two doors out of a page, guarded differently:
 *   - a link anywhere on the page (the header, a tab, a "back" link): caught
 *     on the way down, so we can ask with our own words, run the cleanup, and
 *     only then go where they were going;
 *   - the browser itself (reload, close, typed address, back button): the
 *     browser asks with its own generic wording (beforeunload) and, if they
 *     go, `pagehide` fires once with no time to wait for anything. The cleanup
 *     is sent as a beacon there, which survives the page closing.
 *
 * `onLeave({ beacon })` must be safe to run twice: a link click runs it, then
 * the navigation it starts fires pagehide, which runs it again.
 */
export default function useLeaveGuard({ active, message, onLeave }) {
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;
  const done = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    done.current = false;

    const beforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const pageHide = () => {
      if (done.current) return;
      done.current = true;
      leaveRef.current?.({ beacon: true });
    };
    const onClick = async (e) => {
      const a = e.target?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || a.target === "_blank") return;
      let url;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.href === window.location.href) return;
      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm(message)) return;
      done.current = true;
      try {
        await leaveRef.current?.({ beacon: false });
      } catch {
        /* leaving anyway */
      }
      window.removeEventListener("beforeunload", beforeUnload);
      window.location.assign(url.href);
    };

    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}

/* POST a small JSON body even while the page is closing. */
export function sendWhileLeaving(url, body, { beacon }) {
  const json = JSON.stringify(body ?? {});
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([json], { type: "application/json" }));
    return Promise.resolve();
  }
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: json, keepalive: true }).catch(() => {});
}
