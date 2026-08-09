"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Loader2, Sparkles } from "lucide-react";

// Cycled while the server fetches + extracts (15-45s) so the wait feels alive.
const LOADING_STEPS = [
  "Reading your website…",
  "Finding the property details…",
  "Picking out your photos…",
  "Filling in the form…",
];

/*
 * "Paste your website" box for the add-listing flow. Calls
 * POST /api/landlord/listing-draft; when the site covers several properties it
 * shows a picker and asks again for the chosen one. Hands the finished draft to
 * the parent via onApply(listing, sourceUrl) — the form itself stays in
 * ListingFormPanel.
 */
export default function ListingDraftImport({ onApply, disabled }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | loading | picker | appfolio | done
  const [error, setError] = useState(null);
  const [propertyChoices, setPropertyChoices] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const stepTimer = useRef(null);

  useEffect(() => () => clearInterval(stepTimer.current), []);

  const startLoading = () => {
    setError(null);
    setPhase("loading");
    setStepIdx(0);
    clearInterval(stepTimer.current);
    stepTimer.current = setInterval(
      () => setStepIdx((i) => Math.min(i + 1, LOADING_STEPS.length - 1)),
      6000
    );
  };
  const stopLoading = () => clearInterval(stepTimer.current);

  const requestDraft = async (targetProperty) => {
    if (!url.trim()) {
      setError("Paste your website address first.");
      return;
    }
    startLoading();
    try {
      const res = await fetch("/api/landlord/listing-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), ...(targetProperty ? { targetProperty } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      stopLoading();

      if (data.pms === "appfolio") {
        setPhase("appfolio");
        return;
      }
      if (!res.ok) {
        setPhase(targetProperty ? "picker" : "idle");
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      if (!data.listing && (data.properties?.length ?? 0) > 1) {
        setPropertyChoices(data.properties.slice(0, 12));
        setPhase("picker");
        return;
      }
      if (!data.listing) {
        setPhase("idle");
        setError(
          "We couldn't pick out a single property from that page. Try pasting the page for one specific property."
        );
        return;
      }
      setPhase("done");
      onApply(data.listing, data.sourceUrl);
    } catch {
      stopLoading();
      setPhase("idle");
      setError("Network error. Please try again.");
    }
  };

  if (phase === "done") return null; // parent shows the import summary banner

  return (
    <div className="mx-6 mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 pt-0">
          <Globe className="h-4 w-4 text-red-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            Have a website? Paste it and we&apos;ll fill this out.
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
            We&apos;ll read your property site and pre-fill the form, photos included. You
            review everything before it goes live.
          </p>

          {phase === "loading" ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <Loader2 className="h-4 w-4 animate-spin text-red-600" />
              {LOADING_STEPS[stepIdx]}
            </div>
          ) : phase === "appfolio" ? (
            <div className="mt-3 rounded-lg border border-red-100 bg-white p-3 text-sm text-gray-700">
              Looks like your listings run on <span className="font-semibold">AppFolio</span>.
              Good news: instead of a one-time import, you can connect it once and your
              listings will create and update themselves.
              <Link
                href="/dashboard/landlord?tab=integrations"
                className="mt-2 block font-medium text-red-600 hover:underline"
              >
                Set up AppFolio auto-sync →
              </Link>
              <button
                type="button"
                onClick={() => setPhase("idle")}
                className="mt-1 text-xs text-gray-500 hover:text-gray-700"
              >
                Try a different address instead
              </button>
            </div>
          ) : phase === "picker" ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-800">
                Your site covers several properties. Which one is this listing for?
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {propertyChoices.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => requestDraft(p)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:border-red-400 hover:bg-red-50"
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.address && (
                      <span className="block text-xs text-gray-500">{p.address}</span>
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase("idle");
                  setPropertyChoices([]);
                }}
                className="mt-2 text-xs text-gray-500 hover:text-gray-700"
              >
                ← Different website
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    requestDraft(null);
                  }
                }}
                placeholder="yourproperty.com"
                disabled={disabled}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={() => requestDraft(null)}
                disabled={disabled}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" /> Fill it out for me
              </button>
            </div>
          )}

          {error && phase !== "loading" && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
