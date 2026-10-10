"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { AlertCircle, Building2, Check, Loader2, RotateCw, X } from "lucide-react";
import AddListingWizard from "@/components/listings/wizard/AddListingWizard";

/*
 * The multi-property import workspace.
 *
 * Every property a landlord ticked in the picker becomes a tab down the left.
 * All of them are read from the website in the background, one at a time,
 * and each ready tab runs the ordinary add-listing steps on the right. Nothing
 * goes live until "Publish all listings", which asks the landlord to confirm
 * they have checked what the AI read, then publishes every tab in turn.
 *
 * It replaced a conveyor that read one property, made the landlord publish it,
 * then moved to the next: nobody could see the batch as a whole, and a mistake
 * found on the fourth building could not be fixed on the first.
 *
 * A property already on Proximity is marked, and its tab adds the landlord's
 * units to that listing or edits the leases they already hold there, instead of
 * creating a second copy of the building.
 *
 * The batch (targets, status, the draft each read produced) is kept in
 * localStorage, and each tab saves its own edits under its own key, so a reload
 * comes back to the same tabs without reading the website again.
 */

const BATCH_KEY = (userId) => `proximity:add-listing-batch:${userId ?? "anon"}`;
const TAB_KEY = (userId, tabKey) => `proximity:add-listing-batch-tab:${userId ?? "anon"}:${tabKey}`;
// One read at a time. Each is a minute or two of fetching and an AI call, the
// import route allows 20 an hour per landlord, and reading in parallel only
// meant several tabs hitting that limit at once.
const CONCURRENCY = 1;

export function loadBatch(userId) {
  try {
    const raw = localStorage.getItem(BATCH_KEY(userId));
    if (!raw) return null;
    const batch = JSON.parse(raw);
    return Array.isArray(batch?.tabs) && batch.tabs.length ? batch : null;
  } catch {
    return null;
  }
}

export function newBatch(targets, pastedUrl) {
  const stamp = Date.now().toString(36);
  return {
    pastedUrl,
    tabs: targets.map((target, i) => ({
      key: `${stamp}-${i}`,
      target,
      status: "queued", // queued | reading | ready | failed | published
      error: null,
      draft: null,
      sourceUrl: null,
      listingId: null,
    })),
  };
}

function forget(userId, tabs) {
  try {
    localStorage.removeItem(BATCH_KEY(userId));
    for (const t of tabs) localStorage.removeItem(TAB_KEY(userId, t.key));
  } catch {
    /* storage blocked: nothing to clear */
  }
}

function StatusLine({ tab, summary }) {
  if (tab.status === "queued")
    return <span className="text-gray-400">Waiting to read…</span>;
  if (tab.status === "reading")
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" /> Reading your website…
      </span>
    );
  if (tab.status === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-red-600">
        <AlertCircle className="h-3 w-3" /> Couldn&apos;t read it
      </span>
    );
  if (tab.status === "published")
    return (
      <span className="inline-flex items-center gap-1 text-green-700">
        <Check className="h-3 w-3" /> Published
      </span>
    );
  if (tab.publishError)
    return (
      <span className="inline-flex items-center gap-1 text-red-600">
        <AlertCircle className="h-3 w-3" /> Needs a fix
      </span>
    );
  if (!summary) return <span className="text-gray-500">Ready to check</span>;
  return (
    <span className="text-gray-500">
      {summary.units} {summary.units === 1 ? "unit" : "units"} · {summary.leases}{" "}
      {summary.leases === 1 ? "lease" : "leases"}
    </span>
  );
}

export default function ImportBatch({ user, initial, onDone, onCancel }) {
  const userId = user?.id;
  // A read in flight when the page was left is started again.
  const [tabs, setTabs] = useState(() =>
    initial.tabs.map((t) => (t.status === "reading" ? { ...t, status: "queued" } : t))
  );
  const pastedUrl = initial.pastedUrl;
  const [activeKey, setActiveKey] = useState(() => initial.tabs[0]?.key ?? null);
  const [confirmed, setConfirmed] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState(null);
  const [summaries, setSummaries] = useState({});
  const apis = useRef({});
  const inFlight = useRef(new Set());

  const patchTab = (key, patch) =>
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));

  useEffect(() => {
    // A finished batch has been cleared already; writing it back would reopen it.
    if (tabs.every((t) => t.status === "published")) return;
    try {
      localStorage.setItem(BATCH_KEY(userId), JSON.stringify({ pastedUrl, tabs }));
    } catch {
      /* best-effort, like the wizard's own autosave */
    }
  }, [tabs, pastedUrl, userId]);

  // ---------------------------------------------------------------- reading
  const readTab = async (tab) => {
    inFlight.current.add(tab.key);
    patchTab(tab.key, { status: "reading", error: null });
    const { name, address, url, levelUrl, preread } = tab.target;
    try {
      // A single-property site was read before the workspace opened.
      const res = preread
        ? { ok: true, status: 200, json: async () => preread }
        : await fetch("/api/landlord/listing-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The page this property was listed on, not always the pasted one: a
        // company's buildings can sit behind an area page.
        body: JSON.stringify({
          url: levelUrl || pastedUrl,
          targetProperty: { name, address: address || "", url },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.listing) {
        patchTab(tab.key, {
          status: "failed",
          error:
            res.status === 429
              ? "Import limit reached (20 reads an hour). Try this one again later, or fill it in by hand."
              : data.error || "We couldn't read this property from your website.",
        });
        return;
      }
      /*
       * Now that the full address is known, check it against what is already
       * on Proximity by the database's own address key. This is the reliable
       * marker; the picker's was a guess from a name and a street. A listing
       * of the landlord's own opens for editing, anyone else's for adding to.
       */
      const existing = await findExisting(data.listing.address);
      // The property's own page is what the weekly check should re-read; the
      // page we fetched is often the company's list it was picked from.
      patchTab(tab.key, {
        status: "ready",
        draft: data.listing,
        sourceUrl: url || data.sourceUrl || null,
        // The read travels in the draft from here on; keep the saved batch small.
        target: {
          ...tab.target,
          preread: undefined,
          alreadyListed: existing === undefined ? tab.target.alreadyListed : existing,
        },
      });
    } catch {
      patchTab(tab.key, { status: "failed", error: "Network error while reading this property." });
    } finally {
      inFlight.current.delete(tab.key);
    }
  };

  useEffect(() => {
    const free = CONCURRENCY - inFlight.current.size;
    if (free <= 0) return;
    tabs
      .filter((t) => t.status === "queued" && !inFlight.current.has(t.key))
      .slice(0, free)
      .forEach(readTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  // undefined = could not check (keep what the picker said), null = not listed.
  const findExisting = async (address) => {
    if (!address) return undefined;
    try {
      const res = await fetch(`/api/properties/lookup?address=${encodeURIComponent(address)}`);
      if (!res.ok) return undefined;
      const data = await res.json();
      return data.match ?? null;
    } catch {
      return undefined;
    }
  };

  // Publishing found the address taken after all: the tab becomes an edit of
  // that listing instead of a second copy of it.
  const becomeExisting = (key, existing) =>
    setTabs((prev) =>
      prev.map((t) =>
        t.key === key ? { ...t, target: { ...t.target, alreadyListed: existing } } : t
      )
    );

  // A property the website would not give up can still be listed by hand.
  const fillByHand = (tab) =>
    patchTab(tab.key, {
      status: "ready",
      error: null,
      draft: {
        title: tab.target.name,
        address: tab.target.alreadyListed?.address || tab.target.address || "",
        units: [],
      },
    });

  const removeTab = (key) => {
    const tab = tabs.find((t) => t.key === key);
    if (tab) forget(userId, [tab]);
    // Keep the batch record itself: forget() cleared it, the effect rewrites it.
    delete apis.current[key];
    const rest = tabs.filter((t) => t.key !== key);
    setTabs(rest);
    if (activeKey === key) setActiveKey(rest[0]?.key ?? null);
    if (!rest.length) onCancel();
  };

  const discardAll = () => {
    if (!window.confirm("Discard this import? Nothing has been published, and your edits will be lost.")) return;
    forget(userId, tabs);
    onCancel();
  };

  // --------------------------------------------------------------- publishing
  const toPublish = tabs.filter((t) => t.status === "ready");
  const stillReading = tabs.filter((t) => t.status === "queued" || t.status === "reading").length;
  const unreadable = tabs.filter((t) => t.status === "failed").length;
  const nameOf = (t) => summaries[t.key]?.title || t.target.name;

  const publishAll = async () => {
    setMessage(null);
    if (stillReading) {
      setMessage(`Wait for ${stillReading} more to finish reading first.`);
      return;
    }
    if (!toPublish.length) {
      setMessage("There is nothing ready to publish.");
      return;
    }
    if (!confirmed) {
      setMessage("Tick the box to confirm you have checked every listing.");
      return;
    }
    // Everything is checked before anything is sent, so a problem on the last
    // tab never leaves the first few published and the rest half-done.
    for (const t of toPublish) {
      const api = apis.current[t.key]?.current;
      const problem = api?.firstProblem();
      if (problem) {
        setActiveKey(t.key);
        api.showProblem(problem);
        setMessage(`${nameOf(t)}: ${problem.problem}`);
        return;
      }
    }
    setPublishing(true);
    let published = 0;
    const failures = [];
    for (const t of toPublish) {
      const api = apis.current[t.key]?.current;
      const result = api ? await api.submit() : { ok: false, error: "This tab did not load." };
      if (result.ok) {
        published += 1;
        patchTab(t.key, { status: "published", listingId: result.listingId, publishError: null });
      } else {
        failures.push(t);
        patchTab(t.key, { publishError: result.error });
      }
    }
    setPublishing(false);
    if (!failures.length && !unreadable) {
      toast.success(`${published} ${published === 1 ? "listing" : "listings"} published`);
      forget(userId, tabs);
      onDone();
      return;
    }
    if (failures.length) setActiveKey(failures[0].key);
    setMessage(
      `${published} published.${
        failures.length
          ? ` ${failures.length} need${failures.length === 1 ? "s" : ""} a fix: see the tab${
              failures.length === 1 ? "" : "s"
            } marked in red.`
          : ""
      }${unreadable ? ` ${unreadable} couldn't be read and ${unreadable === 1 ? "was" : "were"} skipped.` : ""}`
    );
  };

  let host = "your website";
  try {
    host = new URL(pastedUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep fallback */
  }

  // ------------------------------------------------------------------ render
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-6">
      {/*
        The title, publish button and confirmation stay pinned under the site
        header while the landlord scrolls a long units step, so publishing is
        always one click away. The offsets match Header's height.
      */}
      <div className="sticky top-[83px] z-40 -mx-4 mb-5 border-b border-gray-200 bg-gray-50/95 px-4 pb-4 pt-5 backdrop-blur md:top-[104px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Review your listings</h1>
          <p className="mt-1 text-sm text-gray-500">
            {tabs.length} {tabs.length === 1 ? "property" : "properties"} from {host}. Check each
            one on the left, then publish them together.
          </p>
          <button
            type="button"
            onClick={discardAll}
            className="mt-1 text-xs text-gray-400 hover:text-red-600"
          >
            Discard this import
          </button>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-72">
          <button
            type="button"
            onClick={publishAll}
            disabled={publishing || !toPublish.length}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {publishing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
              </>
            ) : (
              `Publish all listings${toPublish.length ? ` (${toPublish.length})` : ""}`
            )}
          </button>
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
            />
            <span>
              The AI can make mistakes. I&apos;ve checked all of the details on every listing.
            </span>
          </label>
        </div>
      </div>

      {(message || stillReading > 0) && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700">
          {message ??
            `Reading ${stillReading} more from your website, one at a time. You can check the finished ones meanwhile.`}
        </div>
      )}
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* Tabs: a column on desktop, a scrolling row on a phone. */}
        <nav className="flex gap-2 overflow-x-auto pb-1 md:w-64 md:shrink-0 md:flex-col md:overflow-visible md:pb-0">
          {tabs.map((t) => {
            const active = t.key === activeKey;
            return (
              <div
                key={t.key}
                className={`group relative flex min-w-[12rem] items-start rounded-lg border text-left transition-colors md:min-w-0 ${
                  active ? "border-red-500 bg-red-50" : "border-gray-200 bg-white hover:border-red-300"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveKey(t.key)}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                >
                  <span className="block truncate pr-4 text-sm font-medium text-gray-900">
                    {nameOf(t)}
                  </span>
                  {t.target.alreadyListed && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                      <Building2 className="h-3 w-3" />
                      {t.target.alreadyListed.mine ? "On Proximity · yours" : "On Proximity"}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px]">
                    <StatusLine tab={t} summary={summaries[t.key]} />
                  </span>
                </button>
                {t.status !== "published" && !publishing && (
                  <button
                    type="button"
                    onClick={() => removeTab(t.key)}
                    aria-label={`Remove ${nameOf(t)} from this import`}
                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-gray-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          {tabs.map((t) => {
            const active = t.key === activeKey;
            return (
              <div key={t.key} className={active ? "" : "hidden"}>
                {t.publishError && t.status === "ready" && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                    {t.publishError}
                  </div>
                )}
                {(t.status === "queued" || t.status === "reading") && (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-12 text-center">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    <p className="text-sm text-gray-700">
                      {t.status === "queued" ? "Waiting to read" : "Reading"} {t.target.name}…
                    </p>
                    <p className="text-xs text-gray-400">Usually a minute or two.</p>
                  </div>
                )}
                {t.status === "failed" && (
                  <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
                    <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
                    <p className="mt-2 text-sm font-medium text-gray-900">{t.target.name}</p>
                    <p className="mt-1 text-sm text-gray-600">{t.error}</p>
                    <div className="mt-4 flex justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => patchTab(t.key, { status: "queued", error: null })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-red-300"
                      >
                        <RotateCw className="h-4 w-4" /> Try again
                      </button>
                      <button
                        type="button"
                        onClick={() => fillByHand(t)}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
                      >
                        Fill it in by hand
                      </button>
                    </div>
                  </div>
                )}
                {t.status === "published" && (
                  <div className="rounded-xl border border-green-200 bg-green-50 p-8 text-center">
                    <Check className="mx-auto h-6 w-6 text-green-600" />
                    <p className="mt-2 text-sm font-medium text-gray-900">{nameOf(t)} is live.</p>
                    {t.listingId && (
                      <Link
                        href={`/listings/${t.listingId}`}
                        className="mt-2 inline-block text-sm font-medium text-red-600 hover:underline"
                      >
                        View listing
                      </Link>
                    )}
                  </div>
                )}
                {t.status === "ready" && (
                  <AddListingWizard
                    user={user}
                    onClose={() => {}}
                    onSuccess={() => {}}
                    batch={{
                      tabKey: t.key,
                      draft: t.draft,
                      sourceUrl: t.sourceUrl,
                      pastedUrl,
                      existing: t.target.alreadyListed || null,
                      onRegister: (key, ref) => {
                        apis.current[key] = ref;
                      },
                      onSummary: (key, summary) =>
                        setSummaries((prev) => ({ ...prev, [key]: summary })),
                      onExisting: becomeExisting,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
