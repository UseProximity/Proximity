"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Folder, Globe, Loader2, Sparkles } from "lucide-react";

// Cycled while the server fetches + extracts so the wait feels alive.
const LOADING_STEPS = [
  "Reading your website…",
  "Finding the property details…",
  "Picking out your photos…",
  "Filling in the form…",
];

/*
 * "Paste your website" box for the add-listing flow. Calls
 * POST /api/landlord/listing-draft. Multi-property sites get a picker;
 * category pages (neighborhoods, "our communities") come back as kind "group"
 * and drill in like folders, with breadcrumbs and a client-side cache per
 * level so going back is instant. Checked properties survive drilling. The
 * first pick prefills the form now and the rest queue up via
 * onApply(listing, { sourceUrl, pastedUrl, queue }).
 */
export default function ListingDraftImport({ onApply, disabled, embedded = false }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | loading | picker | pms | done
  const [pmsName, setPmsName] = useState("");
  // Set when the landlord chooses "read my website instead" of the PMS sync
  // (their plan may not include API access); carried on every later request.
  const skipPmsRef = useRef(false);
  const [error, setError] = useState(null);
  const [choices, setChoices] = useState([]); // current level: [{name,address,url,kind}]
  const [crumbs, setCrumbs] = useState([]); // [{label, url}] drill path
  const [selected, setSelected] = useState(() => new Set()); // keys: choice url|name
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef({});
  const levelCache = useRef(new Map()); // levelUrl -> choices
  const pendingRef = useRef([]); // multi-select picks still waiting after the first

  useEffect(
    () => () => {
      clearInterval(timers.current.step);
      clearInterval(timers.current.clock);
    },
    []
  );

  const keyOf = (p) => p.url || p.name;

  const startLoading = () => {
    setError(null);
    setPhase("loading");
    setStepIdx(0);
    setElapsed(0);
    clearInterval(timers.current.step);
    clearInterval(timers.current.clock);
    timers.current.step = setInterval(
      () => setStepIdx((i) => Math.min(i + 1, LOADING_STEPS.length - 1)),
      7000
    );
    timers.current.clock = setInterval(() => setElapsed((s) => s + 1), 1000);
  };
  const stopLoading = () => {
    clearInterval(timers.current.step);
    clearInterval(timers.current.clock);
  };

  // One API call. levelUrl overrides the fetched page (drilling into a group).
  const requestDraft = async (targetProperty, levelUrl) => {
    const fetchUrl = levelUrl ?? crumbs.at(-1)?.url ?? url.trim();
    if (!fetchUrl) {
      setError("Paste your website address first.");
      return;
    }
    startLoading();
    try {
      const res = await fetch("/api/landlord/listing-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: fetchUrl,
          ...(targetProperty ? { targetProperty } : {}),
          ...(skipPmsRef.current ? { skipPmsSteer: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      stopLoading();

      if (data.pms) {
        setPmsName(
          { appfolio: "AppFolio", buildium: "Buildium", rentecdirect: "Rentec Direct", doorloop: "DoorLoop" }[
            data.pms
          ] ?? "your property-management system"
        );
        setPhase("pms");
        return;
      }
      if (!res.ok) {
        setPhase(choices.length ? "picker" : "idle");
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      if (data.listing) {
        setPhase("done");
        const queue = pendingRef.current;
        pendingRef.current = [];
        onApply(data.listing, {
          sourceUrl: data.sourceUrl,
          pastedUrl: url.trim() || fetchUrl,
          queue,
        });
        return;
      }

      const list = (data.properties ?? []).slice(0, 40);
      if (list.length > 0) {
        // A target that turned out to be another list acts like a drill-in.
        if (targetProperty) {
          setCrumbs((c) => [
            ...c,
            { label: targetProperty.name, url: targetProperty.url ?? fetchUrl },
          ]);
        }
        levelCache.current.set(fetchUrl, list);
        // First time we see a level, every real property starts checked —
        // most landlords want all of them. Unchecks stick when they revisit.
        setSelected((prev) => {
          const next = new Set(prev);
          list.filter((p) => p.kind !== "group").forEach((p) => next.add(keyOf(p)));
          return next;
        });
        setChoices(list);
        setPhase("picker");
        return;
      }

      setPhase("idle");
      setError(
        "We couldn't pick out a property from that page. Try pasting the page for one specific property."
      );
    } catch {
      stopLoading();
      setPhase(choices.length ? "picker" : "idle");
      setError("Network error. Please try again.");
    }
  };

  const drillInto = (group) => {
    if (!group.url) return;
    const cached = levelCache.current.get(group.url);
    setCrumbs((c) => [...c, { label: group.name, url: group.url }]);
    if (cached) {
      setChoices(cached);
      return;
    }
    requestDraft(null, group.url);
  };

  const goToCrumb = (idx) => {
    // idx -1 = the pasted site's top level
    const nextCrumbs = idx < 0 ? [] : crumbs.slice(0, idx + 1);
    const levelUrl = idx < 0 ? url.trim() : nextCrumbs.at(-1).url;
    setCrumbs(nextCrumbs);
    const cached = levelCache.current.get(levelUrl);
    if (cached) setChoices(cached);
    else requestDraft(null, levelUrl);
  };

  const toggleSelected = (p) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(p);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Every checked property across all drilled levels, in cache order.
  const allSelectedTargets = () => {
    const picks = [];
    const seen = new Set();
    for (const list of levelCache.current.values()) {
      for (const p of list) {
        const k = keyOf(p);
        if (p.kind !== "group" && selected.has(k) && !seen.has(k)) {
          seen.add(k);
          picks.push({ name: p.name, address: p.address ?? null, url: p.url ?? null });
        }
      }
    }
    return picks;
  };

  const importSelected = () => {
    const picks = allSelectedTargets();
    if (!picks.length) {
      setError("Check at least one property first.");
      return;
    }
    pendingRef.current = picks.slice(1);
    requestDraft(picks[0], url.trim());
  };

  if (phase === "done") return null; // parent shows the import summary banner

  const propertiesHere = choices.filter((p) => p.kind !== "group");
  const selectedCount = allSelectedTargets().length;

  return (
    <div
      className={
        embedded
          ? "rounded-xl border border-gray-200 bg-gray-50 p-4"
          : "mx-6 mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
      }
    >
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
              <span className="text-xs text-gray-400">{elapsed}s (usually 20-40s)</span>
            </div>
          ) : phase === "pms" ? (
            <div className="mt-3 rounded-lg border border-red-100 bg-white p-3 text-sm text-gray-700">
              Looks like your listings run on <span className="font-semibold">{pmsName}</span>.
              Instead of a one-time import, you can connect it once and your listings
              will create and update themselves.
              <p className="mt-1.5 text-xs text-gray-500">
                Heads up: syncing needs a {pmsName} plan that includes API access.
                Not sure yours does? Import from your website instead.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link
                  href="/dashboard/landlord?tab=integrations"
                  className="font-medium text-red-600 hover:underline"
                >
                  Set up {pmsName} auto-sync →
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    skipPmsRef.current = true;
                    requestDraft(null);
                  }}
                  className="font-medium text-gray-700 hover:text-red-600 hover:underline"
                >
                  Read my website instead
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPhase("idle")}
                className="mt-1.5 text-xs text-gray-500 hover:text-gray-700"
              >
                Try a different address instead
              </button>
            </div>
          ) : phase === "picker" ? (
            <div className="mt-3">
              {/* Breadcrumbs when drilled into a neighborhood/category */}
              {crumbs.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                  <button
                    type="button"
                    onClick={() => goToCrumb(-1)}
                    className="font-medium text-red-600 hover:underline"
                  >
                    All properties
                  </button>
                  {crumbs.map((c, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      {i === crumbs.length - 1 ? (
                        <span className="text-gray-700">{c.label}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => goToCrumb(i)}
                          className="font-medium text-red-600 hover:underline"
                        >
                          {c.label}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-800">
                  {propertiesHere.length > 0
                    ? "Check every property you want to list. We'll set them up one at a time."
                    : "Open an area to see its properties."}
                </p>
                {propertiesHere.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        const allOn = propertiesHere.every((p) => next.has(keyOf(p)));
                        propertiesHere.forEach((p) =>
                          allOn ? next.delete(keyOf(p)) : next.add(keyOf(p))
                        );
                        return next;
                      })
                    }
                    className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                  >
                    {propertiesHere.every((p) => selected.has(keyOf(p)))
                      ? "Clear all"
                      : "Select all"}
                  </button>
                )}
              </div>

              <div className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {choices.map((p, i) =>
                  p.kind === "group" ? (
                    <button
                      key={i}
                      type="button"
                      onClick={() => drillInto(p)}
                      className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:border-red-400 hover:bg-red-50"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ) : (
                    <label
                      key={i}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors ${
                        selected.has(keyOf(p))
                          ? "border-red-500 bg-red-50"
                          : "border-gray-300 hover:border-red-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(keyOf(p))}
                        onChange={() => toggleSelected(p)}
                        className="mt-0.5 accent-red-600"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-gray-800">
                          {p.name}
                        </span>
                        {p.address &&
                          p.address.toLowerCase().replace(/[.\s]+$/, "") !==
                            p.name.toLowerCase().replace(/[.\s]+$/, "") && (
                            <span className="block truncate text-xs text-gray-500">
                              {p.address}
                            </span>
                          )}
                      </span>
                    </label>
                  )
                )}
              </div>

              <div className="mt-2 flex items-center gap-3">
                {(propertiesHere.length > 0 || selectedCount > 0) && (
                  <button
                    type="button"
                    onClick={importSelected}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                    disabled={selectedCount === 0}
                  >
                    <Sparkles className="h-4 w-4" />
                    Import{" "}
                    {selectedCount > 1 ? `${selectedCount} properties` : "selected"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPhase("idle");
                    setChoices([]);
                    setCrumbs([]);
                    setSelected(new Set());
                    levelCache.current = new Map();
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  ← Different website
                </button>
              </div>
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
