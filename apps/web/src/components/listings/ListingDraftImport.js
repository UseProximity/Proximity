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
 * campus are listed first and start ticked, and the rest sit behind a "show
 * more" line on the same level.
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
  // "inventory" marks the folder the server synthesised from the site's own
  // "all properties" link. Only ever shown at the top level.
  source: p.source ?? null,
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
 * Turn one API level into rows: the buildings we can place near campus, then
 * the site's own areas, then everything further out flagged `far`.
 *
 * `far` used to be wrapped in a folder called "Everywhere else". That nested
 * badly — opening the inventory folder produced a second "Everywhere else"
 * inside the first, and neither was a real place on the landlord's site. It is
 * now a plain "show more" line per level, which cannot nest and does not
 * pretend to be a folder.
 */
function buildLevel(items, levelUrl) {
  const capped = (items ?? []).slice(0, MAX_PER_LEVEL);
  const stampNear = levelIsNearCampus(levelUrl);
  const props = capped
    .filter((p) => p.kind !== "group")
    .map((p) => (stampNear ? { ...p, nearLevel: true } : p));
  const folders = capped.filter((p) => p.kind === "group");

  return [
    ...props.filter(nearCampus).map((p) => makeNode(p, levelUrl)),
    ...folders.map((f) => makeNode(f, levelUrl)),
    ...props
      .filter((p) => !nearCampus(p))
      .map((p) => ({ ...makeNode(p, levelUrl), far: true })),
  ];
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
  // Level keys whose further-from-campus rows are expanded.
  const [showFar, setShowFar] = useState(() => new Set());
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const timers = useRef({});
  const pastedRef = useRef("");
  const skipPmsRef = useRef(false); // landlord chose "read my website instead"
  const autoRan = useRef(false);
  // Mirrors `tree` so folder loads can dedupe against what is already on screen
  // without closing over a stale copy of it.
  const treeRef = useRef([]);

  useEffect(
    () => () => {
      clearInterval(timers.current.step);
      clearInterval(timers.current.clock);
    },
    []
  );

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

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
      treeRef.current = rows;
      setSelected(new Set(defaultChecked(rows)));
      setFilter("");
      setShowFar(new Set());
      setPhase("picker");
      // Everything around WashU comes out of its area folder and onto the
      // first screen, ticked (see absorbNearAreas).
      absorbNearAreas(rows);
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

  /*
   * Pull the areas around WashU up onto the first screen.
   *
   * A three-city company files our buildings under a city folder, so the thing
   * the landlord actually came to list started one click down and unticked.
   * On the first read we open any area that reads as near campus, lift the
   * buildings inside it up to the top level, tick them, and drop the folder
   * when nothing is left in it. Areas that are not ours (Chicago, Kansas City)
   * stay closed folders, so nothing is hidden and nothing is presumed.
   *
   * When the site has an inventory page, that page wins and the marketing area
   * pages are left alone. A company's city page is copy, not a list: Mac's St.
   * Louis page names nine buildings where their searchable inventory holds
   * thirteen, so reading only the city page lost four. Merging the two was
   * worse still, because that page's prose also yielded a "Terrace" that
   * appears nowhere in their inventory and is, on the evidence, a private
   * terrace rather than a building. So the authoritative list decides what
   * gets ticked, and the area folders stay open to browse.
   */
  const absorbNearAreas = async (rows) => {
    const inventory = rows.filter((n) => n.kind === "folder" && n.url && n.source === "inventory");
    const areas = inventory.length
      ? inventory
      : rows.filter((n) => n.kind === "folder" && n.url && nearCampus(n));
    if (!areas.length) return;

    setTree((t) =>
      t.map((n) => (areas.some((a) => a.uid === n.uid) ? { ...n, loading: true } : n))
    );

    const loaded = await Promise.all(
      areas.map(async (area) => {
        try {
          const { ok, data } = await apiCall(area.url, null);
          if (!ok || data.pms) return { area, rows: null };
          const items = data.listing
            ? [
                {
                  name: data.listing.title || data.listing.address || area.name,
                  address: data.listing.address ?? "",
                  url: area.url,
                  kind: "property",
                },
              ]
            : data.properties;
          return { area, rows: buildLevel(items, area.url) };
        } catch {
          return { area, rows: null };
        }
      })
    );

    const hoisted = [];
    setTree((prev) => {
      const known = new Set();
      walkTree(prev, (n) => {
        if (n.kind === "property") known.add(n.id);
      });

      const leftovers = new Map(); // area uid -> what stays inside it
      for (const { area, rows: children } of loaded) {
        if (!children) {
          leftovers.set(area.uid, null); // unreadable: leave the folder as it was
          continue;
        }
        const keep = [];
        for (const c of children) {
          // The server offers its "all properties" folder on every level; it is
          // only shown at the top, so it must not be the one thing keeping an
          // emptied area folder alive.
          if (c.kind === "folder" && c.source === "inventory") continue;
          const isNearProperty = c.kind === "property" && !c.far;
          if (isNearProperty && !known.has(c.id)) {
            known.add(c.id);
            hoisted.push(c);
          } else if (c.kind !== "property" || !known.has(c.id)) {
            keep.push(c); // further-out buildings and sub-areas stay put
          }
        }
        leftovers.set(area.uid, keep);
      }

      const next = [];
      for (const n of prev) {
        const keep = leftovers.has(n.uid) ? leftovers.get(n.uid) : undefined;
        if (keep === undefined) {
          next.push(n);
        } else if (keep === null) {
          next.push({ ...n, loading: false }); // could not read it
        } else if (keep.length) {
          next.push({ ...n, loading: false, children: keep, open: false });
        }
        // an area with nothing left in it is dropped: it is all on screen now
      }
      return [...next, ...hoisted];
    });

    if (hoisted.length) {
      setSelected((sel) => new Set([...sel, ...hoisted.map((h) => h.id)]));
    }
  };

  // ------------------------------------------------------------ folder opening
  const toggleFolder = async (node) => {
    if (node.children) {
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
      /*
       * A building can be listed on more than one page of the same site, so
       * opening Mac's St. Louis folder showed One Hundred Above the Park and
       * Dorchester a second time, under rows already ticked at the top. Keep
       * the copy we already have (it is the one with a link and an address)
       * and drop the repeat.
       */
      const known = new Set();
      walkTree(treeRef.current, (n) => {
        if (n.kind === "property") known.add(n.id);
      });
      const children = buildLevel(items, node.url).filter(
        (c) => c.kind !== "property" || !known.has(c.id)
      );
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

  const propertyRow = (n, depth) => (
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
  );

  const folderRow = (n, depth) => (
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
        <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{n.name}</span>
        {n.loading ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-red-600" /> Opening…
          </span>
        ) : (
          <span className="shrink-0 text-xs text-gray-500">
            {n.children
              ? `${n.children.filter((c) => c.kind === "property").length} inside`
              : "Click to open"}
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
          {renderLevel(n.children, depth + 1, n.uid)}
        </div>
      )}

      {n.open && n.children?.length === 0 && !n.error && (
        <p
          style={{ paddingLeft: `${34 + depth * 18}px` }}
          className="py-1.5 text-xs text-gray-500"
        >
          Nothing left to add from here.
        </p>
      )}
    </div>
  );

  /*
   * One level of the tree. Near-campus buildings, then the site's own areas,
   * then a single "show more" line for everything further out. That last group
   * used to be a folder called "Everywhere else", which nested inside itself
   * and looked like a place on the landlord's website. It is a disclosure now.
   */
  const renderLevel = (nodes, depth, levelKey) => {
    const list = (nodes ?? []).filter(branchMatches);
    const near = list.filter((n) => n.kind === "property" && !n.far);
    const folders = list.filter(
      // The synthesised "all properties" folder belongs at the top level only:
      // inside a folder for one city it leads back out to every other city.
      (n) => n.kind === "folder" && (depth === 0 || n.source !== "inventory")
    );
    const far = list.filter((n) => n.kind === "property" && n.far);
    const farOpen = showFar.has(levelKey) || !!q; // searching reveals everything

    return (
      <>
        {near.map((n) => propertyRow(n, depth))}
        {folders.map((n) => folderRow(n, depth))}
        {far.length > 0 && (
          <div key={`${levelKey}-far`}>
            <button
              type="button"
              onClick={() =>
                setShowFar((prev) => {
                  const next = new Set(prev);
                  if (next.has(levelKey)) next.delete(levelKey);
                  else next.add(levelKey);
                  return next;
                })
              }
              style={{ paddingLeft: `${12 + depth * 18}px` }}
              className="flex w-full items-center gap-2 py-1.5 text-left text-xs font-medium text-gray-600 hover:text-red-600"
            >
              {farOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {farOpen ? "Hide" : "Show"} {far.length} further from campus
            </button>
            {farOpen && <div className="space-y-1">{far.map((n) => propertyRow(n, depth))}</div>}
          </div>
        )}
      </>
    );
  };

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
                {renderLevel(tree, 0, "root")}
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
