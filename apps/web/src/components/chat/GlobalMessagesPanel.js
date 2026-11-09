/*
 * URL-driven messages overlay that can open from any page, mounted once in the
 * root layout next to GlobalListingModal and following the same contract:
 * ?messages=1 opens it, ?messages=1&thread=<id> opens a conversation, closing
 * removes the params with router.replace so the back button works and the link
 * stays shareable.
 *
 * It replaced /messages as a page (that route now redirects here) so the header
 * button no longer costs a page transition, and so sending an enquiry can move
 * straight into the conversation without leaving the listing behind.
 *
 * Suspense because useSearchParams suspends during prerender, same as the
 * listing modal.
 *
 * ?messagesAs=<user id> (admins only, Wyatt, 2026-11-03) opens that person's
 * inbox exactly as they see it, read only, under a banner naming them.
 */
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { X, Eye } from "lucide-react";
import MessagesPanel from "@/components/chat/MessagesPanel";
import { useMessages } from "@/context/MessagesContext";
import {
  messagesOpen,
  openThreadId,
  messagesAsId,
  withoutMessages,
} from "@/lib/chat/messagesUrl";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function GlobalMessagesPanelInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const { setActiveThreadId, setViewAs, inboxFor } = useMessages();

  const open = messagesOpen(searchParams);
  const threadParam = openThreadId(searchParams);
  const asParam = messagesAsId(searchParams);
  const isAdmin = ["super", "admin"].includes(session?.user?.role);
  const wantAs = open && isAdmin && asParam && UUID_RE.test(asParam) ? asParam : null;
  const appliedThreadRef = useRef(null);
  const [viewed, setViewed] = useState(null);

  // Whose inbox this is: the admin's own, or the person they are viewing as.
  useEffect(() => {
    setViewAs(wantAs);
  }, [wantAs, setViewAs]);
  useEffect(() => {
    if (!wantAs) { setViewed(null); return; }
    let cancelled = false;
    fetch(`/api/admin/viewUser?id=${encodeURIComponent(wantAs)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => { if (!cancelled) setViewed(u ? { name: u.name || u.email || "this user", role: u.role } : { name: "this user" }); })
      .catch(() => { if (!cancelled) setViewed({ name: "this user" }); });
    return () => { cancelled = true; };
  }, [wantAs]);
  // The inbox resets when it switches person, so open the thread only after.
  const inboxReady = inboxFor === (wantAs ?? null);

  const close = useCallback(() => {
    router.replace(pathname + withoutMessages(searchParams), { scroll: false });
  }, [router, pathname, searchParams]);

  // Apply ?thread= once per value, so re-renders do not fight the user clicking
  // a different conversation inside the panel.
  useEffect(() => {
    if (!open || !inboxReady) return;
    if (!threadParam || !UUID_RE.test(threadParam)) return;
    const key = `${wantAs ?? ""}:${threadParam}`;
    if (appliedThreadRef.current === key) return;
    appliedThreadRef.current = key;
    setActiveThreadId(threadParam);
  }, [open, inboxReady, wantAs, threadParam, setActiveThreadId]);

  /*
   * The provider outlives this overlay, so closing has to clear the active
   * thread. Otherwise the visibility listeners keep marking it read for the rest
   * of the session and the other participant gets read receipts for a
   * conversation nobody is looking at.
   */
  useEffect(() => {
    if (open) return;
    appliedThreadRef.current = null;
    setActiveThreadId(null);
  }, [open, setActiveThreadId]);

  // Escape closes, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (!open) return null;

  /*
   * Signed out with ?messages=1 in the URL, which happens when someone shares a
   * link or returns to one after signing out. Send them to sign in and back,
   * rather than rendering an empty inbox.
   */
  if (status === "unauthenticated") {
    const callbackUrl =
      typeof window !== "undefined" ? window.location.href : "/";
    router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Messages"
    >
      <button
        type="button"
        aria-label="Close messages"
        onClick={close}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />
      {/* Full screen on a phone, a panel on larger screens. */}
      <div className="relative z-10 flex w-full flex-col bg-white shadow-2xl sm:max-w-5xl sm:rounded-2xl sm:h-[min(80vh,720px)] h-full overflow-hidden">
        {wantAs && (
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
            <Eye className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              Viewing <span className="font-semibold">{viewed?.name ?? "…"}</span>&apos;s inbox exactly as they see it. Read only: nothing is sent or marked as read.
            </span>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Messages</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close messages"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <MessagesPanel
            onBrowse={() => {
              close();
              router.push("/browse");
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function GlobalMessagesPanel() {
  return (
    <Suspense fallback={null}>
      <GlobalMessagesPanelInner />
    </Suspense>
  );
}
