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
 * A site with no more properties than this shows all of them, flat, with no
 * "further from campus" line to open. Folding four buildings into a disclosure
 * is worse than just listing them: the ordinary landlord with a handful of
 * houses should see a handful of houses.
 */
const SMALL_SITE = 12;

/*
 * Proximity only serves students around WashU, and a three-city management
 * company's list is mostly noise to them: Mac Properties has 124 buildings, 13
 * of them in St. Louis. Nothing is hidden (a landlord with an edge-case address
 * must still be able to find their building), but the ones we can place near
 * campus are listed first and start ticked, and the rest sit behind a "show
 * more" line on the same level.
 */
const NEAR_CAMPUS_RE = new RegExp(
  [
    // Any eastern-Missouri postcode. Chicago is 606xx and Kansas City 641xx,
    // so this stays quiet on the cities we actually want to set aside.
    String.raw`\b63\d{3}\b`,
    String.raw`\b(` +
      [
        "st\\.?\\s*louis", "saint\\s*louis", "stl",
        // Inner-ring municipalities, all a short drive from campus.
        "clayton", "university\\s*city", "u\\.?\\s*city", "richmond\\s*heights",
        "maplewood", "brentwood", "webster\\s*groves", "frontenac", "ladue",
        "shrewsbury", "rock\\s*hill", "olivette", "overland", "creve\\s*coeur",
        "kirkwood", "glendale", "warson\\s*woods", "des\\s*peres", "town\\s*and\\s*country",
        "affton", "brentwood", "bel[-\\s]?nor", "pagedale", "wellston", "normandy",
        // Neighbourhoods students actually name.
        "central\\s*west\\s*end", "\\bcwe\\b", "delmar\\s*loop", "the\\s*loop",
        "demun", "de\\s*mun", "skinker", "debaliviere", "de\\s*baliviere",
        "parkview", "ames\\s*place", "kingsbury", "hi[-\\s]?pointe", "dogtown",
        "forest\\s*park\\s*south\\s*east", "forest\\s*park\\s*s\\.?\\s*e", "the\\s*grove",
        "botanical\\s*heights", "shaw", "tower\\s*grove", "the\\s*hill",
        "soulard", "lafayette\\s*square", "benton\\s*park", "midtown", "grand\\s*center",
        "cheltenham", "clifton\\s*heights", "ellendale", "franz\\s*park",
        "west\\s*end", "visitation\\s*park", "wydown", "clayton[-\\s]tamm",
      ].join("|") +
      String.raw`)\b`,
  ].join("|"),
  "i"
);

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
 * Positively somewhere else. Not the opposite of nearCampus: most of the time
 * we simply cannot tell, and "cannot tell" must not mean "hide it".
 *
 * Byron Company is the case that proved it. Every building they own is in St.
 * Louis, but the extraction does not always return a city with the address, and
 * on a run where it returned none the picker decided fourteen of their sixteen
 * buildings were "further from campus" and folded them away. A local landlord
 * should never have to go looking for their own houses.
 *
 * So a property is only set aside when the page actually places it somewhere
 * else: a mailing address with a non-63xxx zip, or a city we can name. Anything
 * unplaced is treated as ours and ticked, which is right far more often than it
 * is wrong, and is one untick when it is wrong.
 */
const ZIP_ELSEWHERE_RE = /,\s*[A-Z]{2}\.?\s*(?!63\d{3})\d{5}\b/;
const CITY_ELSEWHERE_RE =
  /\b(chicago|kansas\s*city|springfield|columbia|indianapolis|nashville|memphis|louisville|cincinnati|cleveland|columbus|detroit|milwaukee|madison|minneapolis|st\.?\s*paul|des\s*moines|omaha|lincoln|wichita|topeka|tulsa|oklahoma\s*city|little\s*rock|fayetteville|dallas|houston|austin|denver|phoenix|atlanta|charlotte|raleigh|new\s*york|brooklyn|boston|philadelphia|baltimore|miami|orlando|tampa|seattle|portland|san\s*francisco|los\s*angeles|san\s*diego|las\s*vegas|salt\s*lake|boise|hyde\s*park)\b/i;

const placedElsewhere = (p) =>
  ZIP_ELSEWHERE_RE.test(p.address ?? "") ||
  CITY_ELSEWHERE_RE.test(flatten(`${p.address ?? ""} ${p.url ?? ""}`));

// Set aside only when we can place it somewhere that is not ours.
const farAway = (p) => !nearCampus(p) && placedElsewhere(p);

/*
 * One building, one identity, wherever it turns up — without merging buildings
 * that merely share a name.
 *
 * Two forces pull against each other here. Mac lists One Hundred Above the Park
 * on its homepage (linked to liveat100.com) and again inside its St. Louis page
 * (named in prose, no link at all); keying on the URL made those two rows, so
 * ticking nine buildings reported eleven and queued two of them twice. But
 * Altus Properties labels NINE different buildings "Pearl Street" on one page,
 * each with its own link, so keying on the name alone collapses nine buildings
 * into one.
 *
 * So: same link means the same building. Same name means the same building
 * unless both links sit on the SAME host, which is the one case where a site is
 * genuinely distinguishing two things it chose to give one label. Mac's
 * Dorchester is dorchesterapartments.com in one place and a macapartments.com
 * path in another — different hosts, one building. Altus's nine Pearl Streets
 * are nine paths on altusproperties.com — same host, nine buildings.
 */
const nameKeyOf = (p) =>
  (p.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const urlKeyOf = (p) => {
  if (!p.url) return null;
  try {
    const u = new URL(p.url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return p.url.toLowerCase();
  }
};

const hostOf = (p) => {
  if (!p.url) return null;
  try {
    return new URL(p.url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};

/*
 * Give every property a stable id, reusing the id of a building already seen.
 * `registry` is carried across levels, so a folder opened later resolves
 * against what is already on screen. Returns the rows worth keeping: a repeat
 * of something already listed is dropped rather than shown twice.
 */
function adopt(rows, registry) {
  const kept = [];
  for (const n of rows) {
    if (n.kind !== "property") {
      /*
       * Folders need de-duplicating too. The inventory page carries the same
       * city links as the front page, and dissolving it lifted them up beside
       * the originals: Chicago, St. Louis and Kansas City each appeared twice.
       */
      const fkey = `folder:${urlKeyOf(n) ?? nameKeyOf(n)}`;
      if (registry.some((e) => e.id === fkey)) continue;
      registry.push({ nameKey: null, urlKey: null, host: null, id: fkey });
      kept.push(n);
      continue;
    }
    const nameKey = nameKeyOf(n);
    const urlKey = urlKeyOf(n);
    const host = hostOf(n);
    const match = registry.find(
      (e) =>
        (urlKey && e.urlKey && e.urlKey === urlKey) ||
        (!!nameKey && e.nameKey === nameKey && (!host || !e.host || e.host !== host))
    );
    if (match) continue; // already on screen; keep the copy we have
    let id = urlKey || nameKey || `row-${registry.length}`;
    while (registry.some((e) => e.id === id)) id = `${id}~${registry.length}`;
    registry.push({ nameKey, urlKey, host, id });
    kept.push({ ...n, id });
  }
  return kept;
}

let _uid = 0;
const makeNode = (p, parentUrl) => ({
  uid: `n${++_uid}`,
  id: nameKeyOf(p), // replaced by adopt() once the level is merged in
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
  // Set by the server when this building is already on Proximity. Dropped
  // here until now, so the picker never showed the marker it was sent.
  alreadyListed: p.alreadyListed ?? null,
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
    ...props.filter((p) => !farAway(p)).map((p) => makeNode(p, levelUrl)),
    ...folders.map((f) => makeNode(f, levelUrl)),
    ...props.filter(farAway).map((p) => ({ ...makeNode(p, levelUrl), far: true })),
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
  const ids = [];
  walkTree(rows, (n) => {
    if (n.kind === "property" && !n.far && !n.alreadyListed) ids.push(n.id);
  });
  return ids;
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
  // Several properties at once: hands every ticked one to the tabbed import
  // workspace instead of reading the first and queueing the rest.
  onImportMany,
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
  /*
   * True while the second pass is still reading the site's inventory page.
   *
   * That read takes around two minutes on a company the size of Mac, and the
   * picker is already on screen showing whatever the front page gave us. With
   * no signal, a landlord sees two buildings and a working Import button and
   * reasonably concludes that is the answer. It is not: thirteen arrive a
   * minute later.
   */
  const [stillSearching, setStillSearching] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const pastedRef = useRef("");
  const skipPmsRef = useRef(false); // landlord chose "read my website instead"
  const autoRan = useRef(false);
  // Mirrors `tree` so folder loads can dedupe against what is already on screen
  // without closing over a stale copy of it.
  const treeRef = useRef([]);
  // Every building seen so far, so a level opened later resolves against what
  // is already on screen rather than repeating it. See adopt().
  const registryRef = useRef([]);

  /*
   * The clock runs off `phase`, not off a timer started inside startLoading().
   *
   * It used to be imperative, and in development React's double-invoked effects
   * tore it down a beat after it was created: the mount effect's cleanup ran
   * after the auto-start had already set its intervals, cleared them, and the
   * guard meant nothing restarted them. The counter sat on "0s" for the whole
   * two-minute read, which reads as frozen. Tied to phase it cannot desync.
   */
  useEffect(() => {
    if (phase !== "loading" && phase !== "picker") return undefined;
    const step = setInterval(
      () => setStepIdx((i) => Math.min(i + 1, LOADING_STEPS.length - 1)),
      7000
    );
    const clock = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(step);
      clearInterval(clock);
    };
  }, [phase]);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const startLoading = () => {
    setError(null);
    setPhase("loading");
    setStepIdx(0);
    setElapsed(0);
  };
  const stopLoading = () => {};

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
      // A one-property site skips the picker entirely. With the import
      // workspace available it still opens there, as a single tab, so it gets
      // the same "already on Proximity" check as a batch; the read already
      // done travels with it rather than being paid for twice.
      if (data.listing && onImportMany) {
        setPhase("done");
        onImportMany(
          [
            {
              name: data.listing.title || data.listing.address || pasted,
              address: data.listing.address || "",
              url: data.sourceUrl || pasted,
              levelUrl: null,
              alreadyListed: null,
              preread: { listing: data.listing, sourceUrl: data.sourceUrl ?? null },
            },
          ],
          pasted
        );
        return;
      }
      if (data.listing) {
        setPhase("done");
        onApply(data.listing, {
          sourceUrl: data.sourceUrl,
          pastedUrl: pasted,
          queue: [],
        });
        return;
      }
      registryRef.current = [];
      const rows = adopt(buildLevel(data.properties, pasted), registryRef.current);
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
    setStillSearching(true);

    /*
     * Hidden, not spinning. These folders are about to be read and folded into
     * the list, and most of them will not exist a minute from now: showing "All
     * properties on your website · Opening…" invites a landlord to click a
     * folder that is midway through dissolving. The banner above the list is
     * what says work is still happening.
     */
    setTree((t) =>
      t.map((n) => (areas.some((a) => a.uid === n.uid) ? { ...n, absorbing: true } : n))
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

    /*
     * Merged outside setTree on purpose. This used to build its result by
     * pushing into an array from inside the state updater, and React calls
     * updaters twice in development to catch exactly that: every hoisted row
     * was added twice, so the picker offered 216 rows for a 124-property site
     * and React warned about duplicate keys. treeRef holds the same state
     * without the trap.
     */
    const prev = treeRef.current;
    const hoisted = [];
    const leftovers = new Map(); // area uid -> what stays inside it
    for (const { area, rows: children } of loaded) {
      if (!children) {
        leftovers.set(area.uid, null); // unreadable: leave the folder as it was
        continue;
      }
      /*
       * The inventory folder is dissolved rather than kept. It held the whole
       * site, so leaving it on screen produced a folder called "All properties
       * on your website" sitting next to the properties, and a second "show N
       * further from campus" line inside it beside the one outside it.
       * Everything it held belongs on the level it came from.
       */
      const dissolve = area.source === "inventory";
      const keep = [];
      // adopt() drops anything already listed and hands back stable ids.
      for (const c of adopt(children, registryRef.current)) {
        // The server offers its "all properties" folder on every level; it is
        // only shown at the top, so it must not be the one thing keeping an
        // emptied area folder alive.
        if (c.kind === "folder" && c.source === "inventory") continue;
        if (c.kind === "property" && (!c.far || dissolve)) {
          hoisted.push(c); // `far` survives, so it lands in the one list
        } else if (dissolve) {
          hoisted.push(c);
        } else {
          keep.push(c); // further-out buildings and sub-areas stay put
        }
      }
      leftovers.set(area.uid, dissolve ? [] : keep);
    }

    const next = [];
    for (const n of prev) {
      const keep = leftovers.has(n.uid) ? leftovers.get(n.uid) : undefined;
      if (keep === undefined) next.push(n);
      else if (keep === null) next.push({ ...n, absorbing: false }); // could not read it
      else if (keep.some((c) => c.kind === "property")) {
        next.push({ ...n, absorbing: false, children: keep, open: false });
      }
      /*
       * An area with no buildings left in it is dropped: either everything it
       * held is now on screen, or all it had was the site's own navigation
       * repeated back at us. Those showed up as folders reading "0 inside",
       * which is a row that costs a click and gives nothing.
       */
    }
    const merged = [...next, ...hoisted];
    treeRef.current = merged;
    setTree(merged);

    const toTick = hoisted.filter((h) => h.kind === "property" && !h.far);
    if (toTick.length) {
      setSelected((sel) => new Set([...sel, ...toTick.map((h) => h.id)]));
    }
    setStillSearching(false);
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
      const children = adopt(buildLevel(items, node.url), registryRef.current);
      setTree((t) => patchNode(t, node.uid, { loading: false, children, error: null }));
      // Anything near campus inside a folder starts ticked, same rule as the
      // top level, so opening "St. Louis" does the obvious thing.
      const auto = [];
      walkTree(children, (c) => {
        if (c.kind === "property" && !c.far) auto.push(c.id);
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
  const toggleOne = (node) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

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

  /*
   * Every row, including the ones already on Proximity. They used to be left
   * out because they could not be picked; now they can (their tab edits the
   * listing that is there), and leaving them out meant that on a site where
   * everything was already listed, "Tick all" and "Untick everything" did
   * nothing at all. Only the picker's own starting ticks skip them.
   */
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
      alreadyListed: p.alreadyListed || null,
    });
    // Every pick opens in the import workspace, one tab each, read in the
    // background and published together; a single pick still gets the same
    // "already on Proximity" check there.
    if (onImportMany) {
      setPhase("done");
      onImportMany(selectedProps.map(payload), pastedRef.current);
      return;
    }
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
    setStillSearching(false);
    setPhase("idle");
    setTree([]);
    setSelected(new Set());
    setFilter("");
    setError(null);
  };

  if (phase === "done") return null; // parent shows the import summary banner

  // --------------------------------------------------------------- rendering
  const totalRows = allProperties.length;
  const nearCount = allProperties.filter((p) => !p.far).length;
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

  const propertyRow = (n, depth, showBadge = false) => (
    /*
     * A property already on Proximity is marked, and can still be picked.
     *
     * Picking one does not create a second copy of the building: it opens as
     * its own tab in the import, where the landlord adds their units to the
     * existing listing or edits the leases they already hold there. "Select
     * all" still leaves these unticked, so nobody adds to a building by
     * accident.
     */
    <label
      key={n.uid}
      style={{ paddingLeft: `${12 + depth * 18}px` }}
      className={`flex items-center gap-2.5 rounded-lg border py-2 pr-3 text-left text-sm transition-colors ${
        selected.has(n.id)
          ? "cursor-pointer border-red-500 bg-red-50"
          : "cursor-pointer border-gray-200 bg-white hover:border-red-300"
      }`}
    >
      <input
        type="checkbox"
        checked={selected.has(n.id)}
        onChange={() => toggleOne(n)}
        className="h-4 w-4 shrink-0 accent-red-600 disabled:opacity-40"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-gray-900">
          {n.name}
        </span>
        {n.address &&
          n.address.toLowerCase().replace(/[.\s]+$/, "") !==
            n.name.toLowerCase().replace(/[.\s]+$/, "") && (
            <span className="block truncate text-xs text-gray-500">{n.address}</span>
          )}
      </span>
      {/* Only worth showing when rows further out are on screen to contrast
          with. A column of identical badges is decoration. */}
      {n.alreadyListed && (
        <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
          {n.alreadyListed.mine ? "On Proximity · yours" : "On Proximity"}
        </span>
      )}
      {!n.alreadyListed && showBadge && nearCampus(n) && (
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
      (n) =>
        n.kind === "folder" &&
        // The synthesised "all properties" folder belongs at the top level
        // only: inside a folder for one city it leads back out to every other
        // city. And a folder being absorbed right now is not offered at all.
        !n.absorbing &&
        (depth === 0 || n.source !== "inventory")
    );
    const far = list.filter((n) => n.kind === "property" && n.far);
    // A short list is just a list. The disclosure only earns its place when
    // hiding rows actually saves the landlord something.
    const small = near.length + far.length <= SMALL_SITE;
    const farOpen = small || showFar.has(levelKey) || !!q; // searching reveals all

    return (
      <>
        {near.map((n) => propertyRow(n, depth, farOpen && far.length > 0))}
        {folders.map((n) => folderRow(n, depth))}
        {far.length > 0 && (
          <div key={`${levelKey}-far`}>
            {!small && (
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
            )}
            {farOpen && (
              <div className="space-y-1">{far.map((n) => propertyRow(n, depth))}</div>
            )}
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
              {/* Lead with the number that matters. "We found 124 properties"
                  is true and alarming when twelve of them are the point. */}
              <p className="text-sm font-medium text-gray-800">
                {nearCount > 0 && nearCount < totalRows
                  ? `${nearCount} propert${
                      nearCount === 1 ? "y" : "ies"
                    } near WashU ${nearCount === 1 ? "is" : "are"} ticked and ready.`
                  : `We found ${totalRows} propert${
                      totalRows === 1 ? "y" : "ies"
                    } on your website.`}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {nearCount > 0 && nearCount < totalRows
                  ? `Untick anything you don't want. Your website has ${
                      totalRows - nearCount
                    } more further from campus, and any folders below are yours to open.`
                  : "Tick the ones you want on Proximity. Nothing goes live until you publish it."}
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
                  Tick all {totalRows}
                </button>
                <button
                  type="button"
                  onClick={() => setAll(false)}
                  className="text-gray-500 hover:text-gray-700 hover:underline"
                >
                  Untick everything
                </button>
              </div>

              {stillSearching && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
                  <span>
                    <span className="font-semibold">Still reading the rest of your website.</span>{" "}
                    Large websites take a minute or two. More properties will appear here
                    as we find them, so give it a moment before you import.
                    <span className="ml-1 text-amber-700">{elapsed}s</span>
                  </span>
                </div>
              )}

              <div className="mt-2 max-h-[55vh] space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                {renderLevel(tree, 0, "root")}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={importSelected}
                  disabled={!selectedProps.length || stillSearching}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {stillSearching
                    ? "Still searching…"
                    : selectedProps.length === 1
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
                Each property opens in its own tab to check. Nothing goes live until you publish.
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
