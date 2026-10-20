"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { trackEvent } from "@/utils/analytics";

// The sign-up wall. A signed-out visitor ran the whole chat and their three
// picks exist, but the server sent only each pick's intention label (never a
// listing id or any card data, so there is nothing here to un-blur with
// devtools). Three placeholder cards stand in for the real ones, with the
// intention tags visible as the teaser, under a card that explains the deal:
// create an account (or log in) and come straight back here unlocked.
//
// Same intention colors as RecommendationCards so the tags read as the real
// thing once the wall comes down.
const INTENTION_COLORS = {
  "Best overall match": "bg-red-100 text-red-700",
  "Closest to campus": "bg-blue-100 text-blue-700",
  "Best value": "bg-green-100 text-green-700",
  "Best reviews": "bg-yellow-100 text-yellow-700",
  "Most amenities": "bg-purple-100 text-purple-700",
  "Most flexible lease": "bg-orange-100 text-orange-700",
  "Best social fit": "bg-pink-100 text-pink-700",
  "Another strong fit": "bg-slate-100 text-slate-700",
  "Your pick": "bg-teal-100 text-teal-700",
};

// A listing card's silhouette: photo block, title line, price line, two short
// detail lines. Blurred and inert so it reads as "a real card is here".
function PlaceholderCard({ seed }) {
  // Vary the line widths a little per card so the three don't look stamped out.
  const w = ["w-3/4", "w-2/3", "w-4/5"][seed % 3];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden select-none pointer-events-none blur-[3px]">
      <div className="aspect-video bg-gradient-to-br from-gray-200 via-gray-100 to-gray-200" />
      <div className="p-3 space-y-2">
        <div className={`h-3.5 ${w} rounded bg-gray-300`} />
        <div className="h-3 w-1/3 rounded bg-red-200" />
        <div className="flex gap-2 pt-1">
          <div className="h-2.5 w-14 rounded bg-gray-200" />
          <div className="h-2.5 w-10 rounded bg-gray-200" />
          <div className="h-2.5 w-16 rounded bg-gray-200" />
        </div>
      </div>
    </div>
  );
}

export default function LockedMatches({ recommendations, triesLeft }) {
  const picks = (recommendations ?? []).slice(0, 3);
  const rootRef = useRef(null);
  // The wall mounts after Proxy's "here are your matches" bubble finishes typing,
  // which is after the chat window's own scroll-to-newest ran, so it would land
  // half below the fold. Scroll the CHAT COLUMN (the nearest scrollable
  // ancestor) to its end once the wall exists. Not scrollIntoView: that would
  // scroll the page too (the footer sits below the chat), which ChatWindow
  // deliberately never does.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      let el = rootRef.current?.parentElement;
      while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) {
        el = el.parentElement;
      }
      el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, []);
  if (!picks.length) return null;
  const click = (action) => trackEvent("Proxy Wall Clicked", { action });

  return (
    // min-h: on desktop the three placeholder cards are a single short row, and
    // the wall card is taller than that row, so the wrapper reserves its height.
    <div ref={rootRef} className="relative min-h-[340px] flex flex-col justify-center">
      {/* Desktop: three across, like the real cards. Mobile: stacked. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2" aria-hidden="true">
        {picks.map((rec, i) => {
          const intentionClass = INTENTION_COLORS[rec.intention] ?? "bg-gray-100 text-gray-700";
          return (
            <div key={`${rec.intention}-${i}`} className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mt-2">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${intentionClass}`}>
                  {rec.intention}
                </span>
              </div>
              <PlaceholderCard seed={i} />
            </div>
          );
        })}
      </div>

      {/* The wall itself, centered over the placeholders. */}
      <div className="absolute inset-0 flex items-center justify-center p-2">
        <div className="w-full max-w-xs bg-white/95 backdrop-blur-sm rounded-2xl border border-gray-200 shadow-lg px-5 py-5 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-red-100 text-red-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <h3 className="mt-3 text-base font-bold text-gray-900">Your 3 matches are ready</h3>
          <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">
            Create a free account to see them, save them, and have Proxy email the owners for you.
          </p>
          <Link
            href="/login?tab=signup&callbackUrl=/matchmaking"
            onClick={() => click("signup")}
            className="mt-4 block w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition"
          >
            Create a free account
          </Link>
          <Link
            href="/login?callbackUrl=/matchmaking"
            onClick={() => click("login")}
            className="mt-2 inline-block text-xs font-medium text-gray-500 hover:text-red-600 transition"
          >
            Already have one? Log in
          </Link>
          {typeof triesLeft === "number" && (
            <p className="mt-3 text-[11px] text-gray-400">
              {triesLeft === 0
                ? "That was your last free chat on this device."
                : `${triesLeft} free ${triesLeft === 1 ? "chat" : "chats"} left on this device.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
