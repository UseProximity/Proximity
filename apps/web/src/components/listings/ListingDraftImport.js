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

const COMBINED = "__combined__";

// The picker caps out here. A management company's inventory page can list well
// over a hundred buildings and Proximity would rather show them all, sorted,
// than silently drop the ones that matter.
const MAX_CHOICES = 150;

/*
 * Proximity only serves students around WashU, and a three-city management
 * company's list is mostly noise to them: Mac Properties has 124 buildings, 13
 * of them in St. Louis. Nothing is hidden (a landlord with an edge-case address
 * must still be able to find their building), but the ones we can place near
 * campus sort to the top and start checked, so the common case is one click.
 */
const NEAR_CAMPUS_RE =
  /\b(st\.?\s*louis|saint\s*louis|stl|clayton|university\s*city|u\.?\s*city|richmond\s*heights|maplewood|brentwood|webster\s*groves|frontenac|ladue|shrewsbury|rock\s*hill|olivette|overland|creve\s*coeur|kirkwood|dogtown|central\s*west\s*end|delmar\s*loop|demun|skinker)\b|\b63(10[0-9]|11[0-9]|12[0-9]|13[0-9]|14[0-9])\b/i;

/*
 * The URL counts as evidence here, and only here. The extraction itself is
 * forbidden from reading a city out of a slug (sites mislabel them, and a wrong
 * address on a published listing is a real harm), but this only decides sort
 * order and which boxes start ticked, both of which the landlord sees and can
 * change. It matters: on Mac's inventory page all 13 St. Louis buildings came
 * back with a name and a /apartments/mo/st.-louis/ URL and no address at all,
 * so an address-only test found one of them.
 */
const flatten = (s) => {
  let v = s ?? "";
  try {
    v = decodeURIComponent(v);
  } catch {
    /* a stray % in the URL is not worth failing over */
  }
  return v.replace(/[-_/+.]+/g, " ");
};

const nearCampus = (p) =>
  // nearLevel is stamped on when the page this came from was itself a
  // near-campus folder, so the fact survives into the combined list that
  // "gather areas" builds out of several folders at once.
  p.nearLevel === true ||
  NEAR_CAMPUS_RE.test(flatten(`${p.name ?? ""} ${p.address ?? ""} ${p.url ?? ""}`));

/*
 * A level the landlord reached by opening a St. Louis folder is itself
 * evidence: everything on Mac's St. Louis page is a St. Louis building, even
 * the nine it names in prose with no address and no link of their own. Without
 * this, opening that folder ticked one box out of nine.
 */
const levelIsNearCampus = (levelUrl) => !!levelUrl && nearCampus({ url: levelUrl });

// Folders sit between the near-campus properties and everything else: they are
// how the landlord reaches the rest, so they must not be buried at the bottom
// of a 124-row list.
const rank = (p, near) => (p.kind === "group" ? 1 : near ? 0 : 2);

const orderChoices = (list, levelUrl) => {
  const stamped = levelIsNearCampus(levelUrl)
    ? list.map((p) => (p.kind === "group" ? p : { ...p, nearLevel: true }))
    : list;
  return stamped
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p, nearCampus(a.p)) - rank(b.p, nearCampus(b.p)) || a.i - b.i)
    .map(({ p }) => p);
};

/*
 * What starts checked. When we can place at least one property near campus,
 * only those do, so a landlord importing 124 buildings is not one stray click
 * from queueing all of them. When we can place none (the ordinary single-city
 * landlord, or a site that never states a city), everything starts checked
 * exactly as before.
 */
const defaultChecked = (list) => {
  const props = list.filter((p) => p.kind !== "group");
  const near = props.filter(nearCampus);
  return near.length ? near : props;
};

/*
 * "Paste your website" box for the add-listing flow. Calls
 * POST /api/landlord/listing-draft. Multi-property sites get a picker where
 * BOTH properties and area folders are checkable: checked folders are read in
 * parallel and resolve into one combined, deduped property list (everything
 * pre-checked) before importing. Folders can still be opened with the chevron
 * to browse. The first pick prefills the form now and the rest queue up via
 * onApply(listing, { sourceUrl, pastedUrl, queue }).
 */
export default function ListingDraftImport({ onApply, disabled, embedded = false }) {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | loading | picker | groups | pms | done
  const [pmsName, setPmsName] = useState("");
  const [error, setError] = useState(null);
  const [choices, setChoices] = useState([]); // current level: [{name,address,url,kind}]
  const [crumbs, setCrumbs] = useState([]); // [{label, url}] drill path
  const [selected, setSelected] = useState(() => new Set()); // keys: choice url|name
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [groupProgress, setGroupProgress] = useState({ done: 0, total: 0 });
  const timers = useRef({});
  const levelCache = useRef(new Map()); // levelUrl -> choices
  const pendingRef = useRef([]); // multi-select picks still waiting after the first
  const skipPmsRef = useRef(false); // landlord chose "read my website instead"

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

  const apiCall = async (fetchUrl, targetProperty) => {
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
    return { ok: res.ok, data };
  };

  // One API call driving the UI (paste, drill-browse, or final target import).
  const requestDraft = async (targetProperty, levelUrl) => {
    const fetchUrl = levelUrl ?? crumbs.at(-1)?.url ?? url.trim();
    if (!fetchUrl || fetchUrl === COMBINED) {
      setError("Paste your website address first.");
      return;
    }
    startLoading();
    try {
      const { ok, data } = await apiCall(fetchUrl, targetProperty);
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
      if (!ok) {
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

      const list = orderChoices((data.properties ?? []).slice(0, MAX_CHOICES), fetchUrl);
      if (list.length > 0) {
        // A target that turned out to be another list acts like a drill-in.
        if (targetProperty) {
          setCrumbs((c) => [
            ...c,
            { label: targetProperty.name, url: targetProperty.url ?? fetchUrl },
          ]);
        }
        levelCache.current.set(fetchUrl, list);
        // First sight of a level: the properties worth defaulting to start
        // checked (see defaultChecked).
        setSelected((prev) => {
          const next = new Set(prev);
          defaultChecked(list).forEach((p) => next.add(keyOf(p)));
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

  // Silent level fetch used when resolving checked folders. Returns properties.
  const fetchLevel = async (levelUrl) => {
    const cached = levelCache.current.get(levelUrl);
    if (cached) return cached;
    const { ok, data } = await apiCall(levelUrl, null);
    if (!ok || data.pms) throw new Error(data.error || "area failed");
    let list;
    if (data.listing) {
      // The folder page was itself a single property.
      list = [
        {
          name: data.listing.title || data.listing.address || levelUrl,
          address: data.listing.address ?? "",
          url: levelUrl,
          kind: "property",
        },
      ];
    } else {
      list = orderChoices((data.properties ?? []).slice(0, MAX_CHOICES), levelUrl);
    }
    levelCache.current.set(levelUrl, list);
    return list;
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

  // Every checked entry of a kind, across all seen levels, in cache order.
  const allSelected = (kind) => {
    const picks = [];
    const seen = new Set();
    for (const [levelUrl, list] of levelCache.current.entries()) {
      if (levelUrl === COMBINED) continue;
      for (const p of list) {
        const k = keyOf(p);
        const isGroup = p.kind === "group";
        if ((kind === "group") === isGroup && selected.has(k) && !seen.has(k)) {
          seen.add(k);
          picks.push({
            name: p.name,
            address: p.address ?? "",
            url: p.url || null,
            kind: p.kind,
            // Which page this property was listed on. The queue re-reads that
            // page rather than the pasted homepage, so a building found three
            // levels deep is extracted from the page that actually describes
            // it — and its own domain can be cleared against that page's links.
            levelUrl,
          });
        }
      }
    }
    return picks;
  };

  // Checked folders resolve (in parallel) into one combined property list.
  const resolveGroups = async (groups, looseProps) => {
    setPhase("groups");
    setError(null);
    setGroupProgress({ done: 0, total: groups.length });
    const collected = [];
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const g = groups[cursor++];
        if (!g) return;
        try {
          const list = await fetchLevel(g.url);
          collected.push(...list.filter((p) => p.kind !== "group"));
        } catch {
          /* unreadable area: skip it */
        } finally {
          setGroupProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, groups.length) }, worker));

    const merged = [];
    const seen = new Set();
    for (const p of [...collected, ...looseProps]) {
      const k = keyOf(p).toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(p);
      }
    }
    if (!merged.length) {
      setPhase("picker");
      setError("We couldn't find rentable properties in those areas.");
      return;
    }
    const ordered = orderChoices(merged);
    levelCache.current.set(COMBINED, ordered);
    setCrumbs([{ label: "Your selection", url: COMBINED }]);
    setSelected(new Set(defaultChecked(ordered).map(keyOf)));
    setChoices(ordered);
    setPhase("picker");
  };

  const importSelected = () => {
    const groups = allSelected("group").filter((g) => g.url);
    const props = allSelected("property");
    if (groups.length) {
      resolveGroups(groups, props);
      return;
    }
    if (!props.length) {
      setError("Check at least one property first.");
      return;
    }
    pendingRef.current = props
      .slice(1)
      .map((p) => ({
        name: p.name,
        address: p.address || "",
        url: p.url,
        levelUrl: p.levelUrl,
      }));
    requestDraft(
      { name: props[0].name, address: props[0].address || "", url: props[0].url },
      props[0].levelUrl || url.trim()
    );
  };

  if (phase === "done") return null; // parent shows the import summary banner

  const groupCount = allSelected("group").filter((g) => g.url).length;
  const propCount = allSelected("property").length;

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
            Auto-fill from your own website.
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
            Nothing goes live until you hit publish.
          </p>

          {phase === "loading" ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <Loader2 className="h-4 w-4 animate-spin text-red-600" />
              {LOADING_STEPS[stepIdx]}
              <span className="text-xs text-gray-400">{elapsed}s</span>
            </div>
          ) : phase === "groups" ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
              <Loader2 className="h-4 w-4 animate-spin text-red-600" />
              Reading your areas… {groupProgress.done} of {groupProgress.total}
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
              {/* Breadcrumbs when drilled into an area */}
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
                  Check everything you want to list. Folders are whole areas; we
                  gather the properties inside the ones you check.
                </p>
                {choices.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        const allOn = choices.every((p) => next.has(keyOf(p)));
                        choices.forEach((p) =>
                          allOn ? next.delete(keyOf(p)) : next.add(keyOf(p))
                        );
                        return next;
                      })
                    }
                    className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                  >
                    {choices.every((p) => selected.has(keyOf(p))) ? "Clear all" : "Select all"}
                  </button>
                )}
              </div>

              <div className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                {choices.map((p, i) => (
                  <label
                    key={i}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 py-2 text-left text-sm transition-colors ${
                      selected.has(keyOf(p))
                        ? "border-red-500 bg-red-50"
                        : "border-gray-300 hover:border-red-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(keyOf(p))}
                      onChange={() => toggleSelected(p)}
                      className="accent-red-600"
                    />
                    {p.kind === "group" && (
                      <Folder className="h-4 w-4 shrink-0 text-gray-400" />
                    )}
                    <span className="min-w-0 flex-1">
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
                    {p.kind === "group" && p.url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          drillInto(p);
                        }}
                        title="Open this area"
                        className="shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-red-500"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    )}
                  </label>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-3">
                {(groupCount > 0 || propCount > 0) && (
                  <button
                    type="button"
                    onClick={importSelected}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700"
                  >
                    <Sparkles className="h-4 w-4" />
                    {groupCount > 0
                      ? `Gather properties (${groupCount} area${groupCount > 1 ? "s" : ""}${
                          propCount ? ` + ${propCount}` : ""
                        })`
                      : `Import ${propCount > 1 ? `${propCount} properties` : "selected"}`}
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
                <Sparkles className="h-4 w-4" /> Build my listing
              </button>
            </div>
          )}

          {error && phase !== "loading" && phase !== "groups" && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
