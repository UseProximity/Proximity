"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pin } from "lucide-react";

const DEMO_LISTING = {
  title: "2BR near the Loop",
  address: "512 Forest Park Blvd",
  rentLabel: "$1,450–$1,650 / mo",
};

const UPDATE_ACTIONS = [
  { id: "rent", label: "Update rent" },
  { id: "photos", label: "Update photos" },
  { id: "details", label: "Edit listing details" },
  { id: "ok", label: "Looks good" },
];

function AssistantAvatar({ size = "md" }) {
  const sz = size === "sm" ? "w-8 h-8" : "w-10 h-10";
  return (
    <div
      className={`${sz} rounded-full bg-red-50 border border-red-100 flex items-center justify-center flex-shrink-0 overflow-hidden`}
    >
      <img
        src="/logo.svg"
        alt=""
        className={size === "sm" ? "w-5 h-5" : "w-6 h-6"}
      />
    </div>
  );
}

function Bubble({ children, mine = false }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed ${
          mine
            ? "bg-red-600 text-white rounded-2xl rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-2xl rounded-bl-sm"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function AvailabilityCard({ listing, answered, onAnswer }) {
  return (
    <div className="w-full max-w-[min(100%,20rem)] rounded-2xl border border-gray-200 bg-white shadow-sm px-3.5 py-3 mr-auto">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Availability check
      </p>
      <p className="text-sm font-semibold text-gray-900">{listing.title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{listing.address}</p>
      <p className="text-xs text-gray-400 mt-1">{listing.rentLabel}</p>
      <p className="text-sm text-gray-700 mt-3">
        Is this listing still available?
      </p>
      {answered ? (
        <p className="mt-3 text-xs font-medium text-gray-500">
          You answered:{" "}
          <span
            className={
              answered === "yes" ? "text-green-700" : "text-red-600"
            }
          >
            {answered === "yes" ? "Yes, still available" : "No, not available"}
          </span>
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onAnswer("yes")}
            className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 transition-colors"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onAnswer("no")}
            className="flex-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 text-sm font-medium py-2 transition-colors"
          >
            No
          </button>
        </div>
      )}
    </div>
  );
}

function UpdatePromptCard({ chosen, onChoose }) {
  return (
    <div className="w-full max-w-[min(100%,20rem)] rounded-2xl border border-gray-200 bg-white shadow-sm px-3.5 py-3 mr-auto">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Keep it fresh
      </p>
      <p className="text-sm text-gray-800">
        Want to update anything before we check in again in two weeks?
      </p>
      {chosen ? (
        <p className="mt-3 text-xs font-medium text-gray-500">
          You chose:{" "}
          <span className="text-gray-800">
            {UPDATE_ACTIONS.find((a) => a.id === chosen)?.label}
          </span>
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {UPDATE_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => onChoose(action.id)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                action.id === "ok"
                  ? "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                  : "border-red-200 bg-red-50/80 text-red-700 hover:bg-red-50"
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Demo-only Proximity Assistant thread. No backend — local interactive state
 * for CEO walkthroughs (availability check + update prompts).
 */
export default function ProximityAssistantTranscript({ onBack = null }) {
  const [availability, setAvailability] = useState(null);
  const [updateChoice, setUpdateChoice] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [availability, updateChoice]);

  function handleAvailability(answer) {
    if (availability) return;
    setAvailability(answer);
    if (answer === "no") setUpdateChoice(null);
  }

  function handleUpdate(actionId) {
    if (updateChoice) return;
    setUpdateChoice(actionId);
  }

  const showComposerHint = Boolean(availability);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100 flex-shrink-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="md:hidden -ml-1 p-1.5 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-800 transition-colors"
            aria-label="Back to conversations"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <AssistantAvatar />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900 truncate">
              Proximity Assistant
            </p>
            <span className="inline-flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
              <Pin className="w-2.5 h-2.5" />
              Pinned
            </span>
          </div>
          <p className="text-[11px] text-gray-400 truncate">
            Listing check-ins &amp; updates
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-4 space-y-3">
        <div className="flex justify-center">
          <p className="text-[11px] text-gray-400 font-medium">
            Today · 9:00 AM
          </p>
        </div>

        <Bubble>
          Hi — I&apos;m the Proximity Assistant. Every two weeks I&apos;ll check
          in so your listings stay accurate for students.
        </Bubble>

        <Bubble>
          Quick check on <span className="font-semibold">{DEMO_LISTING.title}</span>
          :
        </Bubble>

        <AvailabilityCard
          listing={DEMO_LISTING}
          answered={availability}
          onAnswer={handleAvailability}
        />

        {availability === "yes" && (
          <>
            <Bubble mine>Yes, still available</Bubble>
            <Bubble>
              Great — we&apos;ll keep it live. Anything you&apos;d like to refresh
              while you&apos;re here?
            </Bubble>
            <UpdatePromptCard
              chosen={updateChoice}
              onChoose={handleUpdate}
            />
          </>
        )}

        {availability === "no" && (
          <>
            <Bubble mine>No, not available</Bubble>
            <Bubble>
              Got it. We&apos;ll mark{" "}
              <span className="font-semibold">{DEMO_LISTING.title}</span> as
              unavailable so students aren&apos;t contacting you about it. You
              can relist anytime from your dashboard.
            </Bubble>
          </>
        )}

        {updateChoice === "ok" && (
          <>
            <Bubble mine>Looks good</Bubble>
            <Bubble>
              Perfect. I&apos;ll check in again in about two weeks. Thanks for
              keeping things up to date!
            </Bubble>
          </>
        )}

        {updateChoice && updateChoice !== "ok" && (
          <>
            <Bubble mine>
              {UPDATE_ACTIONS.find((a) => a.id === updateChoice)?.label}
            </Bubble>
            <Bubble>
              {updateChoice === "rent" &&
                "I'll open a quick rent update for this listing. When you're done, students will see the new price right away."}
              {updateChoice === "photos" &&
                "I'll take you to photo uploads for this listing so you can replace or add shots."}
              {updateChoice === "details" &&
                "I'll open the listing editor so you can tweak amenities, description, or availability dates."}
            </Bubble>
          </>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 border-t border-gray-100 px-3 py-3">
        {showComposerHint ? (
          <p className="text-center text-[11px] text-gray-400 px-2">
            Reply using the options above — I&apos;ll check in again in two
            weeks.
          </p>
        ) : (
          <div className="flex items-end gap-2 opacity-60 pointer-events-none">
            <div className="flex-1 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-400">
              Reply with the buttons above…
            </div>
            <div
              className="w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center flex-shrink-0"
              aria-hidden
            >
              <svg
                className="w-4 h-4"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M3.4 20.6l17.45-7.48a1 1 0 000-1.84L3.4 3.8a.99.99 0 00-1.37.91v5.13c0 .46.31.86.76.97L8.5 12l-5.71 1.19a1 1 0 00-.76.97v5.13c0 .72.75 1.18 1.37.91z" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
