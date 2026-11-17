"use client";

/*
 * "Did you submit your application?" (Wyatt, 2026-11-14).
 *
 * We cannot see inside a landlord's portal, so a student who went to apply
 * on an earlier visit is asked the next time they open the listing, in a bar
 * at the very top of it that stays stuck while they scroll (Wyatt,
 * 2026-11-15). Its height goes into --apply-check-h on the listing so the
 * listing's own sticky header sits just under it instead of behind it, and to
 * `onHeight` for the scroll math (tab jumps, the browse panel's pills). Not in
 * the visit they clicked Apply: they are still
 * filling it in. "Not yet" hides it for this visit only, so it asks again
 * next time; "Yes" and "I'm not applying" settle it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Pen } from "lucide-react";
import { APPLY_CLICKED_EVENT } from "./ApplyButton";

export default function ApplicationCheck({ listingId, signedIn, preview = false, onHeight = null }) {
  const [app, setApp] = useState(null);
  const [busy, setBusy] = useState(false);
  const openedAt = useRef(Date.now());
  const barRef = useRef(null);
  // Apply clicked in this visit, even before the check below has loaded.
  const appliedNow = useRef(false);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;

  useEffect(() => {
    if (!signedIn || preview || !listingId) return;
    let cancelled = false;
    fetch(`/api/applications?listingId=${listingId}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        if (cancelled || appliedNow.current) return;
        const pending = (d.applications ?? []).find(
          (a) => a.status === "started" && Date.parse(a.lastClickedAt) < openedAt.current
        );
        setApp(pending ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [listingId, signedIn, preview]);

  // Apply clicked in this visit: they are mid-application, so no question now.
  useEffect(() => {
    const on = (e) => {
      if (e.detail?.listingId !== listingId) return;
      appliedNow.current = true;
      setApp(null);
    };
    window.addEventListener(APPLY_CLICKED_EVENT, on);
    return () => window.removeEventListener(APPLY_CLICKED_EVENT, on);
  }, [listingId]);

  // Publish the bar's height to the listing (its parent) for the sticky header.
  useLayoutEffect(() => {
    const el = barRef.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const set = () => {
      host.style.setProperty("--apply-check-h", `${el.offsetHeight}px`);
      onHeightRef.current?.(el.offsetHeight);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      host.style.removeProperty("--apply-check-h");
      onHeightRef.current?.(0);
    };
  }, [app]);

  if (!app) return null;

  const answer = async (status) => {
    setBusy(true);
    try {
      const r = await fetch("/api/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id, status }),
      });
      if (!r.ok) { toast.error("Could not save that. Try again."); return; }
      toast.success(status === "applied" ? "Marked as applied. Good luck!" : "Got it.");
      setApp(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={barRef} className="sticky top-0 z-40 border-b border-red-100 bg-red-50">
      {/* pr-16 keeps the text and buttons clear of the popup's round × at top right. */}
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 py-3 pl-4 pr-16 sm:flex-row sm:items-center sm:pl-6">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Pen className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Did you submit your application?</p>
            <p className="text-xs text-gray-600">You opened the landlord&apos;s application here earlier.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => answer("applied")}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
            Yes, I applied
          </button>
          <button type="button" disabled={busy} onClick={() => setApp(null)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            Not yet
          </button>
          <button type="button" disabled={busy} onClick={() => answer("not_applying")}
            className="px-1 text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-50">
            I&apos;m not applying
          </button>
        </div>
      </div>
    </div>
  );
}
