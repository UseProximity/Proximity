"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useLeaveGuard from "@/lib/useLeaveGuard";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Globe,
  Loader2,
  MapPin,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

// Cycled while the server fetches + extracts so the wait feels alive.
const LOADING_STEPS = [
  "Reading the page…",
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

// Within this of campus counts as near when the distance is known. Clayton,
// the Loop, the CWE and the Grove all fall inside it; Chesterfield does not.
const NEAR_KM = 12;

const nearCampus = (p) =>
  typeof p.distanceKm === "number"
    ? p.distanceKm <= NEAR_KM
    : // nearLevel is stamped on when the page this came from was itself a
      // near-campus folder, so a building listed there counts even when the
      // site gave it neither an address nor a link of its own.
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
const farAway = (p) => (typeof p.distanceKm === "number" ? p.distanceKm > NEAR_KM : !nearCampus(p) && placedElsewhere(p));

/*
 * One building, one identity, wherever it turns up, without merging buildings
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
 * path in another, different hosts, one building. Altus's nine Pearl Streets
 * are nine paths on altusproperties.com, same host, nine buildings.
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
function adopt(rows, registry, linkKey = null) {
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
      registry.push({ nameKey: null, urlKey: null, host: null, id: fkey, linkKey });
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
    registry.push({ nameKey, urlKey, host, id, linkKey });
    kept.push({ ...n, id });
  }
  return kept;
}

let _uid = 0;
const makeNode = (p, parentUrl, linkKey) => ({
  uid: `n${++_uid}`,
  // Which of the landlord's pasted links this came from (see the link list).
  linkKey,
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
  // Straight-line distance to campus, when the site's own data had
  // coordinates. Beats every pattern below: River Terrace Gardens in River
  // Edge, New Jersey was "near" because nothing in its text said otherwise.
  distanceKm: typeof p.distanceKm === "number" ? p.distanceKm : null,
  // The whole link was this one page (one apartment on Zillow, say). Only
  // these group with other links into one building (see buildingKeyOf).
  single: p.single === true,
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
 * badly, opening the inventory folder produced a second "Everywhere else"
 * inside the first, and neither was a real place on the landlord's site. It is
 * now a plain "show more" line per level, which cannot nest and does not
 * pretend to be a folder.
 */
function buildLevel(items, levelUrl, linkKey = null) {
  const capped = (items ?? []).slice(0, MAX_PER_LEVEL);
  const stampNear = levelIsNearCampus(levelUrl);
  const props = capped
    .filter((p) => p.kind !== "group")
    .map((p) => (stampNear ? { ...p, nearLevel: true } : p));
  const folders = capped.filter((p) => p.kind === "group");

  return [
    ...props.filter((p) => !farAway(p)).map((p) => makeNode(p, levelUrl, linkKey)),
    ...folders.map((f) => makeNode(f, levelUrl, linkKey)),
    ...props.filter(farAway).map((p) => ({ ...makeNode(p, levelUrl, linkKey), far: true })),
  ];
}

// Depth-first walk over everything currently loaded.
// Indents for the folder tree, one step per level, as literal classes
// Tailwind can see (no inline styles): rows at 12px + 18px a level, the
// rows inside an opened folder 22px further in.
const ROW_PAD = ["pl-[12px]", "pl-[30px]", "pl-[48px]", "pl-[66px]", "pl-[84px]"];
const CHILD_PAD = ["pl-[34px]", "pl-[52px]", "pl-[70px]", "pl-[88px]", "pl-[106px]"];

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
 * "Paste your links" box for the add-listing flow. Calls
 * POST /api/landlord/listing-draft once per link.
 *
 * A landlord can paste several links, one per box: their own website, or one
 * Zillow page per apartment (Wyatt, 2026-11-08). Each box is read as soon as a
 * link lands in it, on its own, so a bad link says so under its own box right
 * away and never holds up the others. What every link finds goes into one list,
 * grouped under the link it came from, and imports as one batch: one review
 * screen, one Publish all, one agreement signature.
 *
 * A multi-property site becomes a browsable tree: near-campus buildings ticked
 * at the top, the site's own areas as folders that open in place underneath
 * themselves. Opening a folder never hides its siblings, because a landlord
 * whose building we filed under the wrong area still has to be able to find it.
 *
 * A building found at two links (their site and Zillow) is listed once, under
 * the link that found it first (see adopt()).
 *
 * Property-management portals are read like any other site here: the picker no
 * longer stops to suggest the PMS integration (Wyatt, 2026-11-08).
 */
const MAX_LINKS = 10;
// The import's own cap (MAX_TARGETS in lib/sourceImport/jobs.js).
const MAX_IMPORT = 40;

const withScheme = (raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

// Two boxes holding the same page, however it was typed.
const linkIdentity = (raw) => {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  try {
    const u = new URL(withScheme(v));
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return v.toLowerCase();
  }
};

// "zillow.com/homedetails/6105-Delmar..." for the heading over a link's rows.
const shortLink = (raw) => {
  let s = String(raw ?? "");
  try {
    const u = new URL(withScheme(s));
    s = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    /* show it as typed */
  }
  return s.length > 52 ? `${s.slice(0, 50)}…` : s;
};

/*
 * Two links to apartments in one building (6829 Kingsbury Blvd APT 1W and
 * APT 2E on Zillow) import as one property with a unit for each (Wyatt,
 * 2026-11-08). The building is the address with the apartment taken out:
 * street line plus zip.
 */
const UNIT_RE = /(?:,\s*|\s+)(?:apt\.?|apartment|unit|ste\.?|suite|#)\s*#?\s*([a-z0-9-]+)\b/i;
const streetOf = (address) => String(address ?? "").replace(UNIT_RE, "").split(",")[0].trim();
const buildingKeyOf = (address) => {
  const a = String(address ?? "");
  const street = streetOf(a).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!/^\d+\s+\S/.test(street)) return null; // no street number: cannot tell
  const zip = a.match(/\b(\d{5})(?:-\d{4})?\b(?![\s\S]*\b\d{5}\b)/)?.[1] ?? "";
  return `${street}|${zip}`;
};
// "Apt 1W", from the address, or null when it names no apartment.
const unitLabelOf = (address) => {
  const m = String(address ?? "").match(UNIT_RE);
  return m ? `Apt ${m[1].toUpperCase()}` : null;
};
// The address without the apartment: "6829 Kingsbury Blvd, Saint Louis, MO 63130".
const buildingAddressOf = (address) => String(address ?? "").replace(UNIT_RE, "").replace(/\s+,/g, ",").trim();

let _linkSeq = 0;
const newLink = (url = "") => ({
  key: `l${++_linkSeq}`,
  url,
  status: "idle", // idle | reading | done | error
  error: null,
  note: null,
  startedAt: null,
  // The second pass, reading a big site's inventory, is still going.
  searching: false,
});

export default function ListingDraftImport({
  onApply,
  // Several properties at once: hands every ticked one to the tabbed import
  // workspace instead of reading the first and queueing the rest.
  onImportMany,
  disabled,
  embedded = false,
  initialUrl = "",
}) {
  // The start screen can hand over several links, one per line.
  const [links, setLinks] = useState(() => {
    const given = String(initialUrl ?? "").split("\n").map((u) => u.trim()).filter(Boolean).slice(0, MAX_LINKS);
    return given.length ? given.map((u) => newLink(u)) : [newLink()];
  });
  const linksRef = useRef(links);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState(null);
  const [tree, setTree] = useState([]);
  const [selected, setSelected] = useState(() => new Set()); // identity strings
  const [filter, setFilter] = useState("");
  // Level keys whose further-from-campus rows are expanded.
  const [showFar, setShowFar] = useState(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const autoRan = useRef(false);
  // Mirrors `tree` so reads finishing at different times merge against what is
  // already on screen without closing over a stale copy of it.
  const treeRef = useRef([]);
  // Every building seen so far, across every link, so a repeat is dropped
  // rather than shown twice. See adopt().
  const registryRef = useRef([]);
  // The box "Add another link" just made, to put the cursor in it.
  const focusKey = useRef(null);

  useEffect(() => {
    linksRef.current = links;
  }, [links]);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const anyReading = links.some((l) => l.status === "reading" || l.searching);

  /*
   * One clock for every box that is reading, tied to state rather than started
   * inside a read: React's double-invoked effects in development used to tear
   * an imperative timer down and leave the counter frozen on "0s".
   */
  useEffect(() => {
    if (!anyReading) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyReading]);

  const patchLink = (key, patch) => {
    linksRef.current = linksRef.current.map((l) => (l.key === key ? { ...l, ...patch } : l));
    setLinks(linksRef.current);
  };
  // A box removed while its read was out: whatever comes back is dropped.
  const linkAlive = (key) => linksRef.current.some((l) => l.key === key);

  // Every read in flight shares this, so leaving the page can stop them all.
  const aborter = useRef(null);
  useLeaveGuard({
    active: anyReading,
    message: "Your links are still being read. Leaving now will throw away everything found so far. Leave anyway?",
    onLeave: () => {
      aborter.current?.abort();
      return Promise.resolve();
    },
  });

  const apiCall = async (fetchUrl) => {
    if (!aborter.current || aborter.current.signal.aborted) aborter.current = new AbortController();
    const res = await fetch("/api/landlord/listing-draft", {
      method: "POST",
      signal: aborter.current.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: fetchUrl, skipPmsSteer: true }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  // A page that turned out to be one property, as a row for the list.
  const singleRow = (data, fallbackName, url) => ({
    name: data.listing.title || data.listing.address || fallbackName,
    address: data.listing.address ?? "",
    url,
    kind: "property",
    alreadyListed: data.properties?.[0]?.alreadyListed ?? null,
    single: true,
  });

  // ------------------------------------------------------------- reading a link
  const readLink = async (key, override) => {
    const link = linksRef.current.find((l) => l.key === key);
    if (!link) return;
    const pasted = String(override ?? link.url).trim();
    if (!pasted) {
      patchLink(key, { status: "error", error: "Paste a link first." });
      return;
    }
    // The same page twice would be read (and counted against the limit) twice.
    const id = linkIdentity(pasted);
    const twin = linksRef.current.find(
      (l) => l.key !== key && ["reading", "done"].includes(l.status) && linkIdentity(l.url) === id
    );
    if (twin) {
      patchLink(key, { url: pasted, status: "error", error: "You already added this link." });
      return;
    }

    patchLink(key, { url: pasted, status: "reading", error: null, note: null, startedAt: Date.now() });
    setError(null);
    try {
      const { ok, data } = await apiCall(pasted);
      if (!linkAlive(key)) return;
      if (!ok || data.pms) {
        patchLink(key, { status: "error", error: data.error || "We couldn't read that link. Check it and try again." });
        return;
      }
      const items = data.listing ? [singleRow(data, pasted, data.sourceUrl || pasted)] : data.properties;
      const rows = adopt(buildLevel(items, data.listing ? null : pasted, key), registryRef.current, key);
      if (!rows.length) {
        patchLink(
          key,
          (items ?? []).length
            ? { status: "done", note: "Everything at this link is already in the list above." }
            : { status: "error", error: "We couldn't pick out a property from that link. Try the page for one specific property." }
        );
        return;
      }
      const merged = [...treeRef.current, ...rows];
      treeRef.current = merged;
      setTree(merged);
      setSelected((sel) => new Set([...sel, ...defaultChecked(rows)]));
      patchLink(key, { status: "done" });
      // Everything around WashU comes out of its area folder and onto the
      // first screen, ticked (see absorbNearAreas).
      absorbNearAreas(rows, key);
    } catch {
      if (!linkAlive(key)) return;
      patchLink(key, { status: "error", error: "Network error. Please try again." });
    }
  };

  // Auto-run when the links came in from the start screen: each is read at once.
  useEffect(() => {
    if (autoRan.current || !initialUrl) return;
    autoRan.current = true;
    for (const l of linksRef.current) if (l.url.trim()) readLink(l.key, l.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  const addLink = () => {
    if (linksRef.current.length >= MAX_LINKS) return;
    const l = newLink();
    focusKey.current = l.key;
    linksRef.current = [...linksRef.current, l];
    setLinks(linksRef.current);
  };

  // Take a link out, with everything it found.
  const removeLink = (key) => {
    const gone = new Set();
    walkTree(
      treeRef.current.filter((n) => n.linkKey === key),
      (n) => {
        if (n.kind === "property") gone.add(n.id);
      }
    );
    const next = treeRef.current.filter((n) => n.linkKey !== key);
    treeRef.current = next;
    setTree(next);
    registryRef.current = registryRef.current.filter((e) => e.linkKey !== key);
    setSelected((sel) => new Set([...sel].filter((id) => !gone.has(id))));
    const rest = linksRef.current.filter((l) => l.key !== key);
    linksRef.current = rest.length ? rest : [newLink()];
    setLinks(linksRef.current);
  };

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
  const absorbNearAreas = async (rows, linkKey) => {
    const inventory = rows.filter((n) => n.kind === "folder" && n.url && n.source === "inventory");
    const areas = inventory.length
      ? inventory
      : rows.filter((n) => n.kind === "folder" && n.url && nearCampus(n));
    if (!areas.length) return;
    patchLink(linkKey, { searching: true, startedAt: Date.now() });

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
          const { ok, data } = await apiCall(area.url);
          if (!ok || data.pms) return { area, rows: null };
          const items = data.listing ? [singleRow(data, area.name, area.url)] : data.properties;
          return { area, rows: buildLevel(items, area.url, linkKey) };
        } catch {
          return { area, rows: null };
        }
      })
    );
    // Removed while its site was being read: nothing to merge into.
    if (!linkAlive(linkKey)) return;

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
      for (const c of adopt(children, registryRef.current, linkKey)) {
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
    patchLink(linkKey, { searching: false });
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
      const { ok, data } = await apiCall(node.url);
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
      const items = data.listing ? [singleRow(data, node.name, node.url)] : data.properties;
      /*
       * A building can be listed on more than one page of the same site, so
       * opening Mac's St. Louis folder showed One Hundred Above the Park and
       * Dorchester a second time, under rows already ticked at the top. Keep
       * the copy we already have (it is the one with a link and an address)
       * and drop the repeat.
       */
      const children = adopt(buildLevel(items, node.url, node.linkKey), registryRef.current, node.linkKey);
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
  const linkUrlOf = (key) => linksRef.current.find((l) => l.key === key)?.url ?? "";

  // Single-page links that land in the same building: building key -> rows.
  const buildingGroups = useMemo(() => {
    const byKey = new Map();
    for (const p of allProperties) {
      if (!p.single) continue;
      const key = buildingKeyOf(p.address);
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), p]);
    }
    return new Map([...byKey].filter(([, rows]) => new Set(rows.map((r) => r.linkKey)).size > 1));
  }, [allProperties]);
  const groupOf = (p) => (p.single ? buildingGroups.get(buildingKeyOf(p.address)) ?? null : null);

  /*
   * What Import sends: one target per property, except that ticked rows in one
   * building become one target carrying each row's link as a unit.
   */
  const targets = useMemo(() => {
    const out = [];
    const done = new Set();
    for (const p of selectedProps) {
      if (done.has(p.id)) continue;
      const group = groupOf(p)?.filter((m) => selected.has(m.id)) ?? [];
      const base = {
        name: p.name,
        address: p.address || "",
        url: p.url,
        levelUrl: p.levelUrl,
        pastedUrl: linkUrlOf(p.linkKey),
        alreadyListed: p.alreadyListed || null,
      };
      if (group.length < 2) {
        out.push(base);
        continue;
      }
      group.forEach((m) => done.add(m.id));
      const street = streetOf(p.address) || p.name;
      out.push({
        ...base,
        name: street,
        address: buildingAddressOf(p.address),
        alreadyListed: group.find((m) => m.alreadyListed)?.alreadyListed ?? null,
        units: group.map((m, i) => ({
          url: m.url,
          pastedUrl: linkUrlOf(m.linkKey),
          label: unitLabelOf(m.address) || `Unit ${i + 1}`,
          address: m.address || "",
        })),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProps, buildingGroups, selected, links]);
  const groupedTargets = targets.filter((t) => t.units);
  const tooMany = targets.length > MAX_IMPORT;

  const importSelected = async () => {
    if (!targets.length) {
      setError("Tick at least one property first.");
      return;
    }
    if (tooMany) {
      setError(`Import up to ${MAX_IMPORT} properties at a time. Untick some and import the rest after.`);
      return;
    }
    const [first, ...rest] = selectedProps;
    // Every pick opens in the import workspace, one tab each, read in the
    // background and published together; a single pick still gets the same
    // "already on Proximity" check there. Each property is read against the
    // link it was found at.
    if (onImportMany) {
      setFinished(true);
      onImportMany(targets, targets[0].pastedUrl);
      return;
    }
    // The older one-at-a-time path (no workspace) has no grouping.
    const payload = (p) => ({
      name: p.name,
      address: p.address || "",
      url: p.url,
      levelUrl: p.levelUrl,
      pastedUrl: linkUrlOf(p.linkKey),
      alreadyListed: p.alreadyListed || null,
    });
    const pastedUrl = payload(first).pastedUrl;
    patchLink(first.linkKey, { status: "reading", startedAt: Date.now() });
    try {
      const res = await fetch("/api/landlord/listing-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: first.levelUrl || pastedUrl,
          targetProperty: { name: first.name, address: first.address || "", url: first.url },
          skipPmsSteer: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      patchLink(first.linkKey, { status: "done" });
      if (!res.ok || !data.listing) {
        setError(
          data.error ||
            `We couldn't read ${first.name}. Untick it and import the rest, or fill that one in by hand.`
        );
        return;
      }
      setFinished(true);
      onApply(data.listing, { sourceUrl: data.sourceUrl, pastedUrl, queue: rest.map(payload) });
    } catch {
      patchLink(first.linkKey, { status: "done" });
      setError("Network error. Please try again.");
    }
  };

  if (finished) return null; // parent shows the import summary banner

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
      className={`${ROW_PAD[Math.min(depth, 4)]} flex items-center gap-2.5 rounded-lg border py-2 pr-3 text-left text-sm transition-colors ${
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
        {typeof n.distanceKm === "number" && (
          <span className="block text-[11px] text-gray-400">
            {n.distanceKm < 1 ? "under a mile" : `${Math.round(n.distanceKm * 0.621 * 10) / 10} mi`} from WashU
          </span>
        )}
      </span>
      {/* Only worth showing when rows further out are on screen to contrast
          with. A column of identical badges is decoration. */}
      {n.alreadyListed && (
        <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
          {n.alreadyListed.mine ? "On Proximity · yours" : "On Proximity"}
        </span>
      )}
      {groupOf(n) && (
        <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
          {unitLabelOf(n.address) ? `${unitLabelOf(n.address)} · same building` : "Same building"}
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
        className={`${ROW_PAD[Math.min(depth, 4)]} flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-gray-50 py-2 pr-3 text-left text-sm transition-colors hover:border-red-300 hover:bg-red-50/40`}
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
          className={`${CHILD_PAD[Math.min(depth, 4)]} py-1.5 text-xs text-red-600`}
        >
          {n.error}
        </p>
      )}

      {n.open && n.children?.length > 0 && (
        <div className="mt-1 space-y-1">
          <div
            className={`${CHILD_PAD[Math.min(depth, 4)]} flex items-center gap-3 pb-0.5 text-xs`}
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
          className={`${CHILD_PAD[Math.min(depth, 4)]} py-1.5 text-xs text-gray-500`}
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
              className={`${ROW_PAD[Math.min(depth, 4)]} flex w-full items-center gap-2 py-1.5 text-left text-xs font-medium text-gray-600 hover:text-red-600`}
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

  const rowsFor = (key) => tree.filter((n) => n.linkKey === key);
  const foundAt = (key) => {
    let count = 0;
    walkTree(rowsFor(key), (n) => {
      if (n.kind === "property") count += 1;
    });
    return count;
  };
  const elapsedOf = (l) => (l.startedAt ? Math.max(0, Math.floor((now - l.startedAt) / 1000)) : 0);
  const last = links[links.length - 1];
  // A fresh box is waiting already: another one would just be clutter.
  const canAdd = links.length < MAX_LINKS && !(last.status === "idle" && !last.url.trim());

  const linkField = (l, i) => {
    const editable = l.status === "idle" || l.status === "error";
    const count = foundAt(l.key);
    const removeBtn = (links.length > 1 || l.status !== "idle") && (
      <button
        type="button"
        onClick={() => removeLink(l.key)}
        aria-label="Remove this link"
        title="Remove this link and what it found"
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600"
      >
        <X className="h-4 w-4" />
      </button>
    );
    return (
      <div key={l.key} className="mt-3 first:mt-0">
        {editable ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              inputMode="url"
              aria-label={`Link ${i + 1}`}
              autoFocus={focusKey.current === l.key}
              value={l.url}
              onChange={(e) => patchLink(l.key, { url: e.target.value, error: null, status: "idle" })}
              onPaste={(e) => {
                // Pasting into an empty box reads it straight away.
                const text = e.clipboardData.getData("text").trim();
                if (!text || l.url.trim()) return;
                e.preventDefault();
                readLink(l.key, text);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  readLink(l.key);
                }
              }}
              placeholder={i === 0 ? "yourproperty.com or a Zillow listing link" : "Another link"}
              disabled={disabled}
              className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${
                l.error ? "border-red-300" : "border-gray-300"
              }`}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => readLink(l.key)}
                disabled={disabled}
                className="inline-flex h-10 flex-1 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60 sm:flex-none"
              >
                <Sparkles className="h-4 w-4" /> {i === 0 && links.length === 1 ? "Find my properties" : "Find"}
              </button>
              {removeBtn}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            {l.status === "reading" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-red-600" />
            ) : (
              <Globe className="h-4 w-4 shrink-0 text-gray-400" />
            )}
            <span className="min-w-0 flex-1 truncate text-gray-800" title={l.url}>
              {shortLink(l.url)}
            </span>
            <span className="shrink-0 text-xs text-gray-500">
              {l.status === "reading"
                ? `${LOADING_STEPS[Math.min(Math.floor(elapsedOf(l) / 7), LOADING_STEPS.length - 1)]} ${elapsedOf(l)}s`
                : `${count} found`}
            </span>
            {removeBtn}
          </div>
        )}

        {l.error && <p className="mt-1.5 text-xs text-red-600">{l.error}</p>}
        {l.note && <p className="mt-1.5 text-xs text-gray-500">{l.note}</p>}

        {l.searching && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
            <span>
              <span className="font-semibold">Still reading the rest of this website.</span>{" "}
              Large websites take a minute or two. More properties will appear here
              as we find them, so give it a moment before you import.
              <span className="ml-1 text-amber-700">{elapsedOf(l)}s</span>
            </span>
          </div>
        )}

        {count > 0 && (
          <div className="mt-1.5 max-h-[45vh] space-y-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
            {renderLevel(rowsFor(l.key), 0, `root-${l.key}`)}
          </div>
        )}
      </div>
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
            Auto-fill from your links.
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
            Paste your website, or a listing page like Zillow. Got more than one? Add each link
            in its own box. Nothing goes live until you hit publish.
          </p>

          {totalRows > 0 && (
            <div className="mt-3">
              {/* Lead with the number that matters. "We found 124 properties"
                  is true and alarming when twelve of them are the point. */}
              <p className="text-sm font-medium text-gray-800">
                {nearCount > 0 && nearCount < totalRows
                  ? `${nearCount} propert${
                      nearCount === 1 ? "y" : "ies"
                    } near WashU ${nearCount === 1 ? "is" : "are"} ticked and ready.`
                  : `We found ${totalRows} propert${totalRows === 1 ? "y" : "ies"}.`}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {nearCount > 0 && nearCount < totalRows
                  ? `Untick anything you don't want. ${totalRows - nearCount} more ${
                      totalRows - nearCount === 1 ? "is" : "are"
                    } further from campus, and any folders below are yours to open.`
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
            </div>
          )}

          <div className="mt-3">{links.map(linkField)}</div>

          {canAdd ? (
            <button
              type="button"
              onClick={addLink}
              disabled={disabled}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Add another link
            </button>
          ) : links.length >= MAX_LINKS ? (
            <p className="mt-2.5 text-xs text-gray-500">
              You can add up to {MAX_LINKS} links at a time. Import these, then add more.
            </p>
          ) : null}

          {totalRows > 0 && (
            <div className="mt-4 border-t border-gray-200 pt-3">
              <button
                type="button"
                onClick={importSelected}
                disabled={!targets.length || anyReading || tooMany}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {anyReading
                  ? "Still reading…"
                  : targets.length === 1
                  ? "Import 1 property"
                  : `Import ${targets.length} properties`}
              </button>
              {groupedTargets.map((t) => (
                <p key={t.address} className="mt-1.5 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">{t.name}</span>: {t.units.length} links in one building
                  import as one property, with a unit for each ({t.units.map((u) => u.label).join(", ")}).
                </p>
              ))}
              {tooMany ? (
                <p className="mt-1.5 text-xs text-red-600">
                  {targets.length} are ticked. Import up to {MAX_IMPORT} at a time: untick some and import them after.
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-500">
                  Each property opens in its own tab to check. Nothing goes live until you publish.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
