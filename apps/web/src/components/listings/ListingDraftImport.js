"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Globe,
  Loader2,
  MapPin,
  Search,
  Sparkles,
} from "lucide-react";

// Cycled while the server fetches + extracts so the wait feels alive.
const LOADING_STEPS = [
  "Reading your website…",
  "Finding the property details…",
  "Picking out your photos…",
  "Filling in the form…",
];

// Per level. A management company's inventory page can list well over a hundred
// buildings and Proximity would rather show them all than silently drop the
// ones that matter.
const MAX_PER_LEVEL = 200;

// Above this many rows, offer the filter box. Below it, a filter is just
// another control to ignore.
const FILTER_THRESHOLD = 12;

/*
 * Proximity only serves students around WashU, and a three-city management
 * company's list is mostly noise to them: Mac Properties has 124 buildings, 13
 * of them in St. Louis. Nothing is hidden (a landlord with an edge-case address
 * must still be able to find their building), but the ones we can place near
 * campus are listed first and start ticked, and everything else is tucked into
 * one folder they can open.
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
  // near-campus folder, so a building listed there counts even when the site
  // gave it neither an address nor a link of its own.
  p.nearLevel === true ||
  NEAR_CAMPUS_RE.test(flatten(`${p.name ?? ""} ${p.address ?? ""} ${p.url ?? ""}`));

const levelIsNearCampus = (levelUrl) => !!levelUrl && nearCampus({ url: levelUrl });

/*
 * One building, one identity, wherever it turns up.
 *
 * A property can appear at more than one level of the same site: Mac lists One
 * Hundred Above the Park on its homepage (linked to liveat100.com) and again
 * inside its St. Louis page (named in prose, with no link at all). Keying
 * selection on the URL made those two different rows, so ticking nine buildings
 * inside a folder reported eleven selected and queued two of them twice. The
 * name is the only field both copies always carry, so the name is the identity.
 */
const identityOf = (p) =>
  (p.name || p.url || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

let _uid = 0;
const makeNode = (p, parentUrl) => ({
  uid: `n${++_uid}`,
  id: identityOf(p),
  name: p.name,
  address: p.address ?? "",
  url: p.url || null,
  kind: p.kind === "group" ? "folder" : "property",
  // The page this was listed on. The import re-reads that page rather than the
  // pasted homepage, so a building found three levels down is read from the
  // page that actually describes it.
  levelUrl: parentUrl,
  nearLevel: p.nearLevel === true,
  children: null, // null = not opened yet
  open: false,
  loading: false,
  error: null,
});

/*
 * Turn one API level into rows. Near-campus buildings sit at the top, then the
 * site's own folders, then everything else inside a single folder of its own,
 * so a landlord with 124 buildings sees thirteen and one tidy pile rather than
 * a wall of Chicago addresses.
 */
function buildLevel(items, levelUrl) {
  const capped = (items ?? []).slice(0, MAX_PER_LEVEL);
  const stampNear = levelIsNearCampus(levelUrl);
  const props = capped
    .filter((p) => p.kind !== "group")
    .map((p) => (stampNear ? { ...p, nearLevel: true } : p));
  const folders = capped.filter((p) => p.kind === "group");

  const near = props.filter(nearCampus);
  const rest = props.filter((p) => !nearCampus(p));

  const rows = [
    ...near.map((p) => makeNode(p, levelUrl)),
    ...folders.map((f) => makeNode(f, levelUrl)),
  ];

  if (near.length && rest.length) {
    rows.push({
      ...makeNode({ name: `Everywhere else (${rest.length})`, kind: "group" }, levelUrl),
      kind: "bucket",
      children: rest.map((p) => makeNode(p, levelUrl)),
    });
  } else {
    rows.push(...rest.map((p) => makeNode(p, levelUrl)));
  }
  return rows;
}

// Depth-first walk over everything currently loaded.
function walkTree(nodes, fn, depth = 0) {
  for (const n of nodes ?? []) {
    fn(n, depth);
    if (n.children) walkTree(n.children, fn, depth + 1);
  }
}

// What starts ticked at a level: the near-campus buildings, or all of them when
// we cannot place any (the ordinary single-city landlord).
function defaultChecked(rows) {
  const props = [];
  walkTree(rows, (n) => {
    if (n.kind === "property") props.push(n);
  });
  const near = props.filter(nearCampus);
  return (near.length ? near : props).map((p) => p.id);
}

// Immutably replace one node, found by uid.
function patchNode(nodes, uid, patch) {
  return nodes.map((n) => {
    if (n.uid === uid) return { ...n, ...patch };
    if (n.children) return { ...n, children: patchNode(n.children, uid, patch) };
    return n;
  });
}

/*
 * "Paste your website" box for the add-listing flow. Calls
 * POST /api/landlord/listing-draft.
 *
 * A multi-property site becomes a browsable tree: near-campus buildings ticked
 * at the top, the site's own areas as folders that open in place underneath
 * themselves. Opening a folder never hides its siblings, because a landlord
 * whose building we filed under the wrong area still has to be able to find it.
 * Ticked buildings import in one run: the first prefills the form now, the rest
 * queue up via onApply(listing, { sourceUrl, pastedUrl, queue }).
 */
export default function ListingDraftImport({
  onApply,
  disabled,
  embedded = false,
  initialUrl = "",
}) {
  const [url, setUrl] = useState(initialUrl);
  const [phase, setPhase] = useState("idle"); // idle | loading | picker | pms | done
  const [pmsName, setPmsName] = useState("");
  const [error, setError] = useState(null);
  const [tree, setTree] = useState([]);
  const [selected, setSelected] = useState(() => new Set()); // identity strings
  const [filter, setFilter] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef({});
  const pastedRef = useRef("");
  const skipPmsRef = useRef(false); // landlord chose "read my website instead"
  const autoRan = useRef(false);

  useEffect(
    () => () => {
      clearInterval(timers.current.step);
      clearInterval(timers.current.clock);
    },
    []
  );

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

  // ---------------------------------------------------------------- first read
  const readSite = async (override) => {
    const pasted = (typeof override === "string" ? override : url).trim();
    if (!pasted) {
      setError("Paste your website address first.");
      return;
    }
    pastedRef.current = pasted;
    startLoading();
    try {
      const { ok, data } = await apiCall(pasted, null);
      stopLoading();

      if (data.pms) {
        setPmsName(
          {
            appfolio: "AppFolio",
            buildium: "Buildium",
            rentecdirect: "Rentec Direct",
            doorloop: "DoorLoop",
          }[data.pms] ?? "your property manager"
        );
        setPhase("pms");
        return;
      }
      if (!ok) {
        setPhase("idle");
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }
      // A one-property site skips the picker entirely.
      if (data.listing) {
        setPhase("done");
        onApply(data.listing, {
          sourceUrl: data.sourceUrl,
          pastedUrl: pasted,
          queue: [],
        });
        return;
      }
      const rows = buildLevel(data.properties, pasted);
      if (!rows.length) {
        setPhase("idle");
        setError(
          "We couldn't pick out a property from that page. Try pasting the page for one specific property."
        );
        return;
      }
      setTree(rows);
      setSelected(new Set(defaultChecked(rows)));
      setFilter("");
      setPhase("picker");
    } catch {
      stopLoading();
      setPhase("idle");
      setError("Network error. Please try again.");
    }
  };

  // Auto-run when the address came in from the start screen.
  useEffect(() => {
    if (autoRan.current || !initialUrl) return;
    autoRan.current = true;
    readSite(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  // ------------------------------------------------------------ folder opening
  const toggleFolder = async (node) => {
    // A bucket is grouped on this side; its contents are already here.
    if (node.kind === "bucket" || node.children) {
      setTree((t) => patchNode(t, node.uid, { open: !node.open }));
      return;
    }
    if (!node.url) return;
    setTree((t) => patchNode(t, node.uid, { open: true, loading: true, error: null }));
    try {
      const { ok, data } = await apiCall(node.url, null);
      if (!ok || data.pms) {
        setTree((t) =>
          patchNode(t, node.uid, {
            loading: false,
            children: [],
            error: data.error || "We couldn't read that page.",
          })
        );
        return;
      }
      // The folder turned out to be one property's own page.
      const items = data.listing
        ? [
            {
              name: data.listing.title || data.listing.address || node.name,
              address: data.listing.address ?? "",
              url: node.url,
              kind: "property",
            },
          ]
        : data.properties;
      const children = buildLevel(items, node.url);
      setTree((t) => patchNode(t, node.uid, { loading: false, children, error: null }));
      // Anything near campus inside a folder starts ticked, same rule as the
      // top level, so opening "St. Louis" does the obvious thing.
      const auto = [];
      walkTree(children, (c) => {
        if (c.kind === "property" && nearCampus(c)) auto.push(c.id);
      });
      if (auto.length) setSelected((s) => new Set([...s, ...auto]));
    } catch {
      setTree((t) =>
        patchNode(t, node.uid, {
          loading: false,
          children: [],
          error: "Network error. Try opening it again.",
        })
      );
    }
  };

  // ---------------------------------------------------------------- selection
  const toggleOne = (node) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });

  // Every loaded property in the tree, deduped by identity, richest copy kept.
  const allProperties = useMemo(() => {
    const byId = new Map();
    const score = (p) => (p.url ? 2 : 0) + (p.address ? 1 : 0);
    walkTree(tree, (n) => {
      if (n.kind !== "property") return;
      const prev = byId.get(n.id);
      if (!prev || score(n) > score(prev)) byId.set(n.id, n);
    });
    return [...byId.values()];
  }, [tree]);

  const selectedProps = useMemo(
    () => allProperties.filter((p) => selected.has(p.id)),
    [allProperties, selected]
  );

  const setAll = (on) => {
    const ids = [];
    walkTree(tree, (n) => {
      if (n.kind === "property") ids.push(n.id);
    });
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const setBranch = (node, on) => {
    const ids = [];
    walkTree(node.children, (n) => {
      if (n.kind === "property") ids.push(n.id);
    });
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  // ------------------------------------------------------------------- import
  const importSelected = async () => {
    if (!selectedProps.length) {
      setError("Tick at least one property first.");
      return;
    }
    const [first, ...rest] = selectedProps;
    const payload = (p) => ({
      name: p.name,
      address: p.address || "",
      url: p.url,
      levelUrl: p.levelUrl,
    });
    startLoading();
    try {
      const { ok, data } = await apiCall(first.levelUrl || pastedRef.current, {
        name: first.name,
        address: first.address || "",
        url: first.url,
      });
      stopLoading();
      if (!ok || !data.listing) {
        setPhase("picker");
        setError(
          data.error ||
            `We couldn't read ${first.name}. Untick it and import the rest, or fill that one in by hand.`
        );
        return;
      }
      setPhase("done");
      onApply(data.listing, {
        sourceUrl: data.sourceUrl,
        pastedUrl: pastedRef.current,
        queue: rest.map(payload),
      });
    } catch {
      stopLoading();
      setPhase("picker");
      setError("Network error. Please try again.");
    }
  };

  const reset = () => {
    setPhase("idle");
    setTree([]);
    setSelected(new Set());
    setFilter("");
    setError(null);
  };

  if (phase === "done") return null; // parent shows the import summary banner

  // --------------------------------------------------------------- rendering
  const totalRows = allProperties.length;
  const q = filter.trim().toLowerCase();
  const matches = (n) => !q || `${n.name} ${n.address}`.toLowerCase().includes(q);
  // A folder stays visible while filtering if it, or anything already loaded
  // inside it, matches.
  const branchMatches = (n) => {
    if (matches(n)) return true;
    let hit = false;
    walkTree(n.children, (c) => {
      if (matches(c)) hit = true;
    });
    return hit;
  };

  const renderRows = (nodes, depth = 0) =>
    (nodes ?? []).filter(branchMatches).map((n) =>
      n.kind === "property" ? (
        <label
          key={n.uid}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
          className={`flex cursor-pointer items-center gap-2.5 rounded-lg border py-2 pr-3 text-left text-sm transition-colors ${
            selected.has(n.id)
              ? "border-red-500 bg-red-50"
              : "border-gray-200 bg-white hover:border-red-300"
          }`}
        >
          <input
            type="checkbox"
            checked={selected.has(n.id)}
            onChange={() => toggleOne(n)}
            className="h-4 w-4 shrink-0 accent-red-600"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-gray-900">{n.name}</span>
            {n.address &&
              n.address.toLowerCase().replace(/[.\s]+$/, "") !==
                n.name.toLowerCase().replace(/[.\s]+$/, "") && (
                <span className="block truncate text-xs text-gray-500">{n.address}</span>
              )}
          </span>
          {nearCampus(n) && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
              <MapPin className="h-3 w-3" /> Near WashU
            </span>
          )}
        </label>
      ) : (
        <div key={n.uid}>
          <button
            type="button"
            onClick={() => toggleFolder(n)}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
            className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 py-2 pr-3 text-left text-sm transition-colors hover:border-red-300 hover:bg-red-50/40"
          >
            {n.open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
            )}
            {n.open ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-gray-500" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-gray-500" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
              {n.name}
            </span>
            {n.loading ? (
              <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-red-600" /> Opening…
              </span>
            ) : (
              <span className="shrink-0 text-xs text-gray-500">
                {n.children ? `${n.children.length} inside` : "Click to open"}
              </span>
            )}
          </button>

          {n.open && n.error && (
            <p
              style={{ paddingLeft: `${34 + depth * 18}px` }}
              className="py-1.5 text-xs text-red-600"
            >
              {n.error}
            </p>
          )}

          {n.open && n.children?.length > 0 && (
            <div className="mt-1 space-y-1">
              <div
                style={{ paddingLeft: `${34 + depth * 18}px` }}
                className="flex items-center gap-3 pb-0.5 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setBranch(n, true)}
                  className="font-medium text-red-600 hover:underline"
                >
                  Tick all in here
                </button>
                <button
                  type="button"
                  onClick={() => setBranch(n, false)}
                  className="text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Untick all
                </button>
              </div>
              {renderRows(n.children, depth + 1)}
            </div>
          )}

          {n.open && n.children?.length === 0 && !n.error && (
            <p
              style={{ paddingLeft: `${34 + depth * 18}px` }}
              className="py-1.5 text-xs text-gray-500"
            >
              Nothing to list in here.
            </p>
          )}
        </div>
      )
    );

  return (
    <div
      className={
        embedded
          ? "rounded-xl border border-gray-200 bg-gray-50 p-4"
          : "mx-6 mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4"
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
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
          ) : phase === "pms" ? (
            <div className="mt-3 rounded-lg border border-red-100 bg-white p-3 text-sm text-gray-700">
              Looks like your listings run on{" "}
              <span className="font-semibold">{pmsName}</span>. Instead of a one-time
              import, you can connect it once and your listings will create and update
              themselves.
              <p className="mt-1.5 text-xs text-gray-500">
                Heads up: syncing needs a {pmsName} plan that includes API access. Not
                sure yours does? Import from your website instead.
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
                    readSite();
                  }}
                  className="font-medium text-gray-700 hover:text-red-600 hover:underline"
                >
                  Read my website instead
                </button>
              </div>
              <button
                type="button"
                onClick={reset}
                className="mt-1.5 text-xs text-gray-500 hover:text-gray-700"
              >
                Try a different address instead
              </button>
            </div>
          ) : phase === "picker" ? (
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-800">
                We found {totalRows} propert{totalRows === 1 ? "y" : "ies"} on your
                website. Tick the ones you want on Proximity.
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                Anything we could place near WashU is ticked already. Open a folder to
                see what is inside it.
              </p>

              {totalRows > FILTER_THRESHOLD && (
                <div className="relative mt-2.5">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search by name or address"
                    className="w-full rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setAll(true)}
                  className="font-medium text-red-600 hover:underline"
                >
                  Tick everything
                </button>
                <button
                  type="button"
                  onClick={() => setAll(false)}
                  className="text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Untick everything
                </button>
              </div>

              <div className="mt-2 max-h-[55vh] space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                {renderRows(tree)}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={importSelected}
                  disabled={!selectedProps.length}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {selectedProps.length === 1
                    ? "Import 1 property"
                    : `Import ${selectedProps.length} properties`}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  ← Different website
                </button>
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                You review and publish each one yourself. Nothing goes live from here.
              </p>
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
                    readSite();
                  }
                }}
                placeholder="yourproperty.com"
                disabled={disabled}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={() => readSite()}
                disabled={disabled}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" /> Find my properties
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
