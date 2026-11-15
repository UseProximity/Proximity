"use client";

/*
 * "Did you submit your application?" (Wyatt, 2026-11-14).
 *
 * We cannot see inside a landlord's portal, so a student who went to apply
 * on an earlier visit is asked here, at the top of Contact, the next time
 * they open the listing. Not in the visit they clicked Apply: they are still
 * filling it in. "Not yet" hides it for this visit only, so it asks again
 * next time; "Yes" and "I'm not applying" settle it.
 */
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { FileSignature } from "lucide-react";
import { APPLY_CLICKED_EVENT } from "./ApplyButton";

export default function ApplicationCheck({ listingId, signedIn, preview = false }) {
  const [app, setApp] = useState(null);
  const [busy, setBusy] = useState(false);
  const openedAt = useRef(Date.now());

  useEffect(() => {
    if (!signedIn || preview || !listingId) return;
    let cancelled = false;
    fetch(`/api/applications?listingId=${listingId}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        if (cancelled) return;
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
    const on = (e) => { if (e.detail?.listingId === listingId) setApp(null); };
    window.addEventListener(APPLY_CLICKED_EVENT, on);
    return () => window.removeEventListener(APPLY_CLICKED_EVENT, on);
  }, [listingId]);

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
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">Did you submit your application?</p>
          <p className="text-xs text-gray-500">You opened the landlord&apos;s application here earlier.</p>
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
          className="px-1 text-xs text-gray-500 underline hover:text-gray-800 disabled:opacity-50">
          I&apos;m not applying
        </button>
      </div>
    </div>
  );
}
