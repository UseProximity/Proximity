"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { emptyUnit, parseUnitNumbers } from "@/components/listings/listingFormOptions";
import StepStart from "@/components/listings/wizard/StepStart";
import StepAddress from "@/components/listings/wizard/StepAddress";
import StepBasics from "@/components/listings/wizard/StepBasics";
import StepUnits from "@/components/listings/wizard/StepUnits";
import StepPerks from "@/components/listings/wizard/StepPerks";
import StepPhotos from "@/components/listings/wizard/StepPhotos";
import StepDescription from "@/components/listings/wizard/StepDescription";
import StepReview from "@/components/listings/wizard/StepReview";
import { compressImage } from "@/utils/compressImage";
import { checkListingDescription } from "@/lib/contentRules";

/*
 * Step-by-step Add Listing flow. One themed question set per screen, a labeled
 * progress bar that never lies, autosave to localStorage, and a review screen
 * before publishing. A website import fills what it can, then the wizard jumps
 * straight to the gaps. Editing an existing listing goes through the property
 * editor (components/listings/editor/) instead — random access beats steps once
 * data exists.
 */

export const STEPS = [
  { id: "address", label: "Address" },
  { id: "basics", label: "Basics" },
  { id: "units", label: "Units & rent" },
  { id: "perks", label: "Amenities" },
  { id: "photos", label: "Photos" },
  { id: "description", label: "Description" },
  { id: "review", label: "Review" },
];

const AUTOSAVE_KEY = (userId) => `proximity:add-listing-draft:${userId ?? "anon"}`;

const blankForm = (user) => ({
  address: "",
  title: "",
  description: "",
  home_type: "apartment",
  lease_type: "standard",
  furnished: false,
  sublease_friendly: false,
  twenty_one_plus: false,
  contact_email: user?.email ?? "",
  contact_phone: user?.phone ?? "",
  contact_name: user?.name ?? "",
  amenities: [],
  utilities_included: [],
  lease_availability: [],
});

export default function AddListingWizard({ user, onClose, onSuccess, initialImportUrl = "" }) {
  const [stepId, setStepId] = useState("start"); // "start" | STEPS ids
  const [form, setForm] = useState(() => blankForm(user));
  const [units, setUnits] = useState([emptyUnit()]);
  const [customAmenities, setCustomAmenities] = useState([]);
  const [error, setError] = useState(null);
  /*
   * A rejection that belongs to one input — currently only a taken property
   * name. Kept separate from `error` because the wizard shows `error` on the
   * step the landlord is standing on, and the name lives back on the
   * Description step; publish happens from Review.
   */
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [visited, setVisited] = useState(() => new Set());

  // Photos staged in the browser; uploaded to R2 after the listing is created.
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedPreviews, setStagedPreviews] = useState([]);

  // Property lookup — does a listing already exist at this address? Picking a
  // known address attaches the lease to that property instead of creating a
  // duplicate. See /api/properties/lookup.
  const [propertyLookup, setPropertyLookup] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [unitSelection, setUnitSelection] = useState({ mode: "new", unitId: null });

  // Street View default cover (fetched when an address suggestion is picked).
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [streetView, setStreetView] = useState({ available: false, url: null });
  const [streetViewDeleted, setStreetViewDeleted] = useState(false);
  const [streetViewLoading, setStreetViewLoading] = useState(false);

  // Website-import state (see ListingDraftImport): amber marks, batch queue.
  const [importInfo, setImportInfo] = useState(null);
  const [importedFields, setImportedFields] = useState(() => new Set());
  const [importQueue, setImportQueue] = useState([]);
  // Rent specials read off the landlord's site, published with the listing.
  const [concessions, setConcessions] = useState([]);
  /*
   * Where this listing is being read from, kept for the publish call.
   *
   * Two URLs, because they answer different questions later: the property's own
   * page is what the weekly check re-reads for rents and availability, and the
   * pasted page is the company's list of properties, where this one is expected
   * to keep appearing. A building that quietly drops off its landlord's own list
   * has almost certainly been let.
   *
   * `importSourceUrl` is per property, so it is rewritten on every queue
   * advance; `importPastedUrl` is the same for the whole batch.
   */
  const importSourceUrl = useRef(null);
  const importPastedUrl = useRef(null);
  const prefetchRef = useRef(null);
  const importBatch = useRef({ done: 0, total: 0 });
  const [resumed, setResumed] = useState(false);
  /*
   * The address the import box starts with, and a key that remounts it.
   * "Start over" used to drop the landlord back on the import box with the same
   * address already in it, which immediately read the same site again — so a
   * typo could not be corrected without leaving the page. Starting over now
   * clears the address and gives them the empty box back.
   */
  const [importSeed, setImportSeed] = useState(initialImportUrl);
  const [importBoxKey, setImportBoxKey] = useState(0);

  /*
   * Imported photos and floor plans download in the background (assets get a
   * 45s timeout), so when the conveyor advances to the next property there can
   * still be downloads in flight belonging to the property we just left. They
   * used to finish and append themselves to whatever was staged by then — the
   * next listing. Every asset job captures the epoch it started in and drops
   * its results if it no longer matches; advancing bumps the epoch and aborts
   * the outstanding fetches so we're not paying for them either.
   */
  const importEpoch = useRef(0);
  const importAborters = useRef(new Set());

  const cancelImportAssets = () => {
    importEpoch.current += 1;
    for (const c of importAborters.current) c.abort();
    importAborters.current.clear();
  };

  // ------------------------------------------------------------------ autosave
  /*
   * The photo URLs an import brought in, kept so a reload can fetch them again.
   *
   * Staged photos are File objects living in memory, and the autosave is
   * localStorage, which cannot hold a file. So a refresh restored the address,
   * the units and the rent, and silently dropped every photo, with nothing on
   * screen to say they had ever been there. Ben lost eight of them that way and
   * reasonably concluded the import had stopped pulling photos at all. The URLs
   * are a few hundred bytes of text, they save happily, and fetching them again
   * costs nothing.
   */
  const [importedPhotoUrls, setImportedPhotoUrls] = useState([]);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY(user?.id));
      if (!raw) return;
      const saved = JSON.parse(raw);
      const hasContent =
        saved?.form &&
        (saved.form.address?.trim() ||
          saved.form.description?.trim() ||
          (saved.units ?? []).some((u) => u.bedrooms !== "" || u.rent !== ""));
      if (!hasContent) return;
      setForm({ ...blankForm(user), ...saved.form });
      setUnits(saved.units?.length ? saved.units : [emptyUnit()]);
      setCustomAmenities(saved.customAmenities ?? []);
      setCoords(saved.coords ?? { lat: null, lng: null });
      if (saved.stepId && saved.stepId !== "start") setStepId(saved.stepId);
      setVisited(new Set(saved.visited ?? []));
      // The photos themselves could not be saved, so go and get them again.
      const savedPhotos = Array.isArray(saved.importedPhotoUrls) ? saved.importedPhotoUrls : [];
      if (savedPhotos.length) {
        setImportedPhotoUrls(savedPhotos);
        setImportInfo((prev) => ({
          ...(prev ?? {}),
          photoCount: 0,
          photosTotal: savedPhotos.length,
          photosLoading: true,
        }));
        importPhotos(savedPhotos);
      }
      setResumed(true);
    } catch {
      /* corrupt draft — start clean */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    try {
      localStorage.setItem(
        AUTOSAVE_KEY(user?.id),
        JSON.stringify({
          form,
          units,
          customAmenities,
          coords,
          stepId,
          visited: [...visited],
          importedPhotoUrls,
          savedAt: Date.now(),
        })
      );
    } catch {
      /* storage full/blocked — autosave is best-effort */
    }
  }, [form, units, customAmenities, coords, stepId, visited, importedPhotoUrls, user?.id]);

  const clearAutosave = () => {
    try {
      localStorage.removeItem(AUTOSAVE_KEY(user?.id));
    } catch {
      /* ignore */
    }
  };

  const startFresh = () => {
    clearAutosave();
    cancelImportAssets();
    setForm(blankForm(user));
    setUnits([emptyUnit()]);
    setCustomAmenities([]);
    setConcessions([]);
    stagedPreviews.forEach((u) => URL.revokeObjectURL(u));
    setStagedFiles([]);
    stagedPhotoUrls.current = new Set();
    setStagedPreviews([]);
    setCoords({ lat: null, lng: null });
    setStreetView({ available: false, url: null });
    setStreetViewDeleted(false);
    setImportedFields(new Set());
    setImportInfo(null);
    setImportQueue([]);
    prefetchRef.current = null;
    importBatch.current = { done: 0, total: 0 };
    setResumed(false);
    setError(null);
    setVisited(new Set());
    importSourceUrl.current = null;
    importPastedUrl.current = null;
    setImportSeed("");
    setImportBoxKey((k) => k + 1);
    setStepId("start");
  };

  // -------------------------------------------------------------- field logic
  const clearImported = (key) =>
    setImportedFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  const setField = (name, value) => {
    clearImported(name);
    // Editing the field the server rejected retires the rejection.
    setFieldError((fe) => (fe?.field === name ? null : fe));
    setForm((f) => ({ ...f, [name]: value }));
  };

  const toggleMulti = (field, val) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(val)
        ? f[field].filter((x) => x !== val)
        : [...f[field], val],
    }));

  const addUnit = () => setUnits((u) => [...u, emptyUnit()]);
  const removeUnit = (i) => setUnits((u) => u.filter((_, idx) => idx !== i));
  const updateUnit = (i, field, val) => {
    clearImported(`u${i}:${field}`);
    setUnits((u) =>
      u.map((unit, idx) => (idx === i ? { ...unit, [field]: val } : unit))
    );
  };
  const toggleUnitTerm = (i, months) =>
    setUnits((u) =>
      u.map((unit, idx) => {
        if (idx !== i) return unit;
        const cur = Array.isArray(unit.leaseTermMonths) ? unit.leaseTermMonths : [];
        const next = cur.includes(months)
          ? cur.filter((m) => m !== months)
          : [...cur, months].sort((a, b) => a - b);
        return { ...unit, leaseTermMonths: next };
      })
    );

  /*
   * Lease terms are nearly always the same on every floor plan in a building,
   * so making a landlord tick "12-Month" on each of five cards is five times
   * the work for one fact. `mirrorTerms` writes one card's terms onto every
   * card; the step decides when that is safe (see StepUnits) and always offers
   * an undo, because a bulk edit nobody asked for is worse than the typing.
   */
  // ---- extra priced offerings on one floor plan --------------------------
  const patchUnit = (i, fn) =>
    setUnits((u) => u.map((unit, idx) => (idx === i ? fn(unit) : unit)));

  const addExtraLease = (i) =>
    patchUnit(i, (unit) => ({
      ...unit,
      extraLeases: [...(unit.extraLeases ?? []), { rent: "", leaseTermMonths: [] }],
    }));

  const removeExtraLease = (i, k) =>
    patchUnit(i, (unit) => ({
      ...unit,
      extraLeases: (unit.extraLeases ?? []).filter((_, idx) => idx !== k),
    }));

  const updateExtraLease = (i, k, patch) =>
    patchUnit(i, (unit) => ({
      ...unit,
      extraLeases: (unit.extraLeases ?? []).map((l, idx) =>
        idx === k ? { ...l, ...patch } : l
      ),
    }));

  const toggleExtraLeaseTerm = (i, k, months) =>
    patchUnit(i, (unit) => ({
      ...unit,
      extraLeases: (unit.extraLeases ?? []).map((l, idx) => {
        if (idx !== k) return l;
        const cur = Array.isArray(l.leaseTermMonths) ? l.leaseTermMonths : [];
        return {
          ...l,
          leaseTermMonths: cur.includes(months)
            ? cur.filter((m) => m !== months)
            : [...cur, months].sort((a, b) => a - b),
        };
      }),
    }));

  const mirrorTerms = (months) =>
    setUnits((u) => u.map((unit) => ({ ...unit, leaseTermMonths: [...months] })));

  // Undo for the above: one atomic write, so it cannot half-apply the way a
  // loop of per-term toggles did.
  const clearTermsExcept = (keepIndex) =>
    setUnits((u) =>
      u.map((unit, idx) =>
        idx === keepIndex ? unit : { ...unit, leaseTermMonths: [] }
      )
    );

  const addCustomAmenity = (v) => {
    const val = v.trim();
    if (!val) return;
    setCustomAmenities((prev) =>
      prev.some((a) => a.toLowerCase() === val.toLowerCase()) ? prev : [...prev, val]
    );
  };
  const removeCustomAmenity = (val) =>
    setCustomAmenities((prev) => prev.filter((a) => a !== val));

  // ------------------------------------------------------------------- photos
  const handleImageFiles = async (files) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const compressed = await Promise.all(imgs.map(compressImage));
    setStagedFiles((prev) => [...prev, ...compressed]);
    setStagedPreviews((prev) => [
      ...prev,
      ...compressed.map((f) => URL.createObjectURL(f)),
    ]);
  };

  const removeStagedImage = (i) => {
    URL.revokeObjectURL(stagedPreviews[i]);
    setStagedFiles((prev) => prev.filter((_, idx) => idx !== i));
    setStagedPreviews((prev) => prev.filter((_, idx) => idx !== i));
  };

  // Drag-reorder support: previews and files must stay index-aligned because
  // upload order (= stagedFiles order) becomes the listing's photo order.
  const reorderStagedPhotos = (nextUrls) => {
    const byUrl = new Map(stagedPreviews.map((u, i) => [u, stagedFiles[i]]));
    setStagedFiles(nextUrls.map((u) => byUrl.get(u)).filter(Boolean));
    setStagedPreviews(nextUrls);
  };
  const removeStagedByUrl = (url) => {
    const i = stagedPreviews.indexOf(url);
    if (i >= 0) removeStagedImage(i);
  };

  const fetchStreetViewPreview = async (address, lat, lng) => {
    setStreetViewDeleted(false);
    setStreetView({ available: false, url: null });
    setStreetViewLoading(true);
    try {
      const params = new URLSearchParams({ address, lat: String(lat), lng: String(lng) });
      const res = await fetch(`/api/streetview/preview?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.available && data?.url) setStreetView({ available: true, url: data.url });
    } catch {
      /* best-effort preview */
    } finally {
      setStreetViewLoading(false);
    }
  };

  // ------------------------------------------------------- website import
  /*
   * Photos already staged, so the same one is never staged twice.
   *
   * A reload fetches the imported photos again, and anything that runs that
   * twice (a double-invoked effect in development, a landlord clicking back
   * into the flow) staged a second copy of every photo: three photos came back
   * as six thumbnails. Keyed on the source URL, which is what we were given and
   * is stable across a reload.
   */
  const stagedPhotoUrls = useRef(new Set());

  const importPhotos = async (rawUrls) => {
    const urls = rawUrls.filter((u) => !stagedPhotoUrls.current.has(u));
    urls.forEach((u) => stagedPhotoUrls.current.add(u));
    if (!urls.length) return;
    const epoch = importEpoch.current;
    const aborter = new AbortController();
    importAborters.current.add(aborter);
    const files = new Array(urls.length);
    // Four at a time: firing a dozen full-size downloads at once overwhelms
    // slow CDNs/connections and times out the proxy; a small pool finishes
    // sooner AND drops fewer photos.
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= urls.length) return;
        if (aborter.signal.aborted) return;
        try {
          const res = await fetch(
            `/api/landlord/listing-draft/image?url=${encodeURIComponent(urls[idx])}`,
            { signal: aborter.signal }
          );
          if (!res.ok) continue;
          const blob = await res.blob();
          if (!blob.type.startsWith("image/")) continue;
          if (blob.size < 15000) continue; // icons/thumbnails, not photos
          const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
          files[idx] = new File([blob], `imported-${idx + 1}.${ext}`, { type: blob.type });
        } catch {
          /* skip this photo */
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
    } finally {
      importAborters.current.delete(aborter);
    }
    // The property moved on under us — these photos belong to the listing we
    // already published, so staging them would attach them to the next one.
    if (epoch !== importEpoch.current) return;
    const ok = files.filter(Boolean);
    if (ok.length) await handleImageFiles(ok);
    setImportInfo((prev) =>
      prev
        ? { ...prev, photosLoading: false, photoCount: (prev.photoCount ?? 0) + ok.length }
        : prev
    );
  };

  /*
   * Floor plans matched to a unit go through the existing floor-plan upload
   * (R2) into that unit's slot; if the upload path is unavailable they fall
   * back to the photo stage so they're never silently lost.
   */
  const importFloorPlans = async (items) => {
    const epoch = importEpoch.current;
    for (const { index, url } of items) {
      // Same conveyor race as importPhotos: a floor plan resolving after the
      // advance would land in the next property's unit slot.
      if (epoch !== importEpoch.current) return;
      try {
        const res = await fetch(
          `/api/landlord/listing-draft/image?url=${encodeURIComponent(url)}`
        );
        if (!res.ok) throw new Error("proxy failed");
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) throw new Error("not an image");
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        const fd = new FormData();
        fd.append(
          "file",
          new File([blob], `floor-plan-${index + 1}.${ext}`, { type: blob.type })
        );
        const up = await fetch("/api/upload/floor-plan", { method: "POST", body: fd });
        const data = await up.json().catch(() => ({}));
        if (!up.ok || !data.url) throw new Error("upload failed");
        if (epoch !== importEpoch.current) return;
        setUnits((us) =>
          us.map((un, i) => (i === index ? { ...un, floorPlanImageUrl: data.url } : un))
        );
      } catch {
        if (epoch === importEpoch.current) importPhotos([url]);
      }
    }
  };

  const requestQueuedDraft = ({ levelUrl, ...target }) =>
    fetch("/api/landlord/listing-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Re-read the page this property was listed on, not the pasted homepage.
      // For a single-site landlord they are the same page; for a company whose
      // buildings sit behind an area folder, the homepage never mentioned this
      // property at all.
      body: JSON.stringify({
        url: levelUrl || importPastedUrl.current,
        targetProperty: target,
      }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.listing) {
        // Carry the status: the queue advance has to tell "this property is
        // unreadable" (skip it) apart from "we're throttled" (stop).
        const err = new Error(data.error || "extract failed");
        err.status = res.status;
        throw err;
      }
      return data;
    });

  const prefetchNext = (queue) => {
    const target = queue[0];
    if (!target) {
      prefetchRef.current = null;
      return;
    }
    const promise = requestQueuedDraft(target).catch(() => null);
    prefetchRef.current = { name: target.name, promise };
  };

  // Which steps still need the landlord (used for gap-jump + progress ticks).
  const stepComplete = useCallback(
    (id) => {
      switch (id) {
        case "address":
          return !!form.address.trim();
        case "units":
          return (
            units.length > 0 &&
            units.every((u) => u.bedrooms !== "" && u.bathrooms !== "") &&
            units.every(
              (u) =>
                u.available === false ||
                (Array.isArray(u.leaseTermMonths) && u.leaseTermMonths.length > 0)
            )
          );
        case "description":
          return !!form.description.trim();
        // Basics carries the required availability answer, so it only counts
        // once it's actually been seen — applyDraft marks it visited when the
        // import supplied a dated availability. Treating any imported field as
        // proof of basics made the bar show it done on the very flow that
        // never asked the question.
        case "basics":
          return visited.has(id);
        case "perks":
          return visited.has(id) || importedFields.size > 0;
        case "photos":
          return visited.has(id) || stagedFiles.length > 0;
        default:
          return false;
      }
    },
    [form, units, visited, importedFields, stagedFiles]
  );

  const applyDraft = (listing, meta) => {
    const { sourceUrl, pastedUrl, queue = [], isQueueAdvance = false } = meta ?? {};
    // Compute the imported-field marks BEFORE any setState: React may run
    // state-updater callbacks later (it batches during queue advances), so
    // side effects inside the setForm updater are lost for the decisions
    // below (which step to land on, address-confirm priority).
    const marked = new Set();
    const importable = {
      address: listing.address,
      title: listing.title,
      description: listing.description,
      home_type: listing.home_type,
      contact_name: listing.contact_name,
      contact_email: listing.contact_email,
      contact_phone: listing.contact_phone,
    };
    for (const [key, val] of Object.entries(importable)) {
      if (val != null && val !== "") marked.add(key);
    }

    setForm((f) => {
      const next = { ...f };
      for (const [key, val] of Object.entries(importable)) {
        if (val != null && val !== "") next[key] = val;
      }
      if (listing.furnished != null) next.furnished = listing.furnished;
      const AMENITIES = new Set(f.amenities);
      (listing.amenities ?? []).forEach((a) => AMENITIES.add(a));
      next.amenities = [...AMENITIES];
      const UTILS = new Set(f.utilities_included);
      (listing.utilities_included ?? []).forEach((u) => UTILS.add(u));
      next.utilities_included = [...UTILS];
      return next;
    });
    if (Array.isArray(listing.customAmenities) && listing.customAmenities.length) {
      setCustomAmenities((prev) => {
        const have = new Set(prev.map((a) => a.toLowerCase()));
        const extra = listing.customAmenities
          .map((a) => String(a).trim())
          .filter((a) => a && !have.has(a.toLowerCase()));
        return [...prev, ...extra];
      });
    }
    let nextUnits = [emptyUnit()];
    const floorPlanImports = [];
    if (Array.isArray(listing.units) && listing.units.length) {
      /*
       * Enough for a real building. Twelve looked generous until One Hundred
       * Above the Park came in with thirty-six floor plans and the landlord was
       * shown twelve of them, all one-bedrooms, with no sign the rest existed.
       * A card the landlord does not want is one click to remove; a floor plan
       * that never arrived is invisible.
       */
      /*
       * Once any floor plan in the import names its apartments, this is a
       * building rather than a house, and the plans whose apartments the site
       * did not publish are units too. Without this they came in with the unit
       * type blank, and a thirty-six plan import stopped at "pick a unit type
       * for each floor plan" with twenty cards to open to find the empty ones.
       * A house, where no plan names an apartment, still asks the question.
       */
      const namesApartments = listing.units.some((u) => (u.unitNames ?? []).length);
      nextUnits = listing.units.slice(0, 40).map((u, i) => {
        for (const fld of ["bedrooms", "bathrooms", "rent", "area", "title"]) {
          if (u[fld] != null && u[fld] !== "") marked.add(`u${i}:${fld}`);
        }
        if (u.floorPlanImageUrl) floorPlanImports.push({ index: i, url: u.floorPlanImageUrl });
        /*
         * The site's own unit identifiers ("2W", "101", "Madrid") fill in the
         * "which units have this floor plan?" boxes, so each one becomes its
         * own listing_units row with its own lease. They used to have nowhere
         * to go and were landing in the floor-plan name box instead.
         */
        const names = (u.unitNames ?? []).filter((n) => typeof n === "string" && n.trim());
        if (names.length) marked.add(`u${i}:unitNumbers`);
        // Lease lengths the site offers on this floor plan, straight onto the
        // chips. RealPage properties publish these per floor plan in their
        // availability feed, which is the only place they exist.
        const terms = [...new Set((u.leaseTermMonths ?? []).filter((m) => Number.isFinite(m) && m > 0))]
          .sort((a, b) => a - b);
        if (terms.length) marked.add(`u${i}:leaseTermMonths`);
        /*
         * Dates the site gave for individual apartments, keyed by unit number.
         * Only taken when there is one date per named unit: a partly filled
         * list would silently put the wrong apartment on the wrong date.
         */
        const dates = u.unitAvailability ?? [];
        const perUnit =
          dates.length === names.length
            ? Object.fromEntries(
                names.map((n, k) => [n, dates[k]]).filter(([, d]) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""))
              )
            : {};
        // Same alignment rule as the dates: all or nothing, so an apartment
        // never inherits the price of the one listed next to it.
        const rentList = u.unitRents ?? [];
        const perUnitRent =
          rentList.length === names.length
            ? Object.fromEntries(
                names.map((n, k) => [n, rentList[k]]).filter(([, r]) => Number.isFinite(r) && r > 0)
              )
            : {};
        /*
         * A price curve becomes one offering per distinct price, with the terms
         * that share it grouped together: 9 and 10 months both at $2,019 is one
         * offering on [9,10], not two identical rows.
         */
        const prices = u.leaseTermPrices ?? [];
        const curve =
          prices.length === terms.length && terms.length
            ? [...prices.reduce((map, price, k) => {
                if (!Number.isFinite(price) || price <= 0) return map;
                const key = Math.round(price);
                map.set(key, [...(map.get(key) ?? []), terms[k]]);
                return map;
              }, new Map())].map(([rent, months]) => ({ rent, leaseTermMonths: months }))
            : [];
        if (curve.length > 1) marked.add(`u${i}:extraLeases`);
        const cheapest = curve.length ? curve.reduce((a, b) => (a.rent <= b.rent ? a : b)) : null;
        return {
          bedrooms: u.bedrooms ?? "",
          bathrooms: u.bathrooms ?? "",
          rent: cheapest ? cheapest.rent : u.rent ?? "",
          area: u.area ?? "",
          // A waitlist-only plan comes in switched off; everything else is on.
          available: u.available !== false,
          title: u.title ?? "",
          floorPlanImageUrl: "",
          leaseTermMonths: cheapest ? cheapest.leaseTermMonths : terms,
          /*
           * A plan the site lists without naming any apartment stays unlabelled
           * on purpose. The database says so outright: a unit may carry a word
           * in front only if it also carries a number ("Unit 1508"), or be
           * "Whole" with no number, or have neither. Giving these a "Unit" with
           * no number to get them past the form's own question is the one shape
           * it refuses, and it took the publish down with a constraint error
           * after the listing row had already been written.
           *
           * So: no word in front, no number, one unnamed unit for the plan. The
           * landlord still sees the floor plan and can name its apartments when
           * one comes free. A card typed by hand never carries this flag, so
           * the form still insists on a unit type everywhere else.
           */
          designator: names.length ? "Unit" : "",
          numbersUnknown: namesApartments && names.length === 0,
          unitNumbers: names.join(", "),
          availableFrom:
            u.availableFrom && u.availableFrom !== "now" ? u.availableFrom : "",
          unitAvailability: perUnit,
          unitRents: perUnitRent,
          // The card itself carries the cheapest offering; the rest hang off it.
          extraLeases: cheapest ? curve.filter((c) => c !== cheapest) : [],
        };
      });
    }
    setUnits(nextUnits);
    if (floorPlanImports.length) importFloorPlans(floorPlanImports);
    setImportedFields(marked);

    importSourceUrl.current = sourceUrl ?? null;
    importPastedUrl.current = pastedUrl ?? importPastedUrl.current;
    setImportQueue(queue);
    prefetchNext(queue);
    if (isQueueAdvance) importBatch.current.done += 1;
    else importBatch.current = { done: 1, total: queue.length + 1 };

    let host = "your website";
    try {
      host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      /* keep fallback */
    }
    /*
     * The draft sends rent specials as plain sentences. This filtered for
     * objects with a `description`, which they stopped being when the
     * extraction schema was flattened to fix a model error — so every special
     * was dropped here, silently, and two buildings published with none
     * although both had one. The API has always taken either shape.
     */
    setConcessions(
      (Array.isArray(listing.concessions) ? listing.concessions : [])
        .map((c) => (typeof c === "string" ? c : c?.description))
        .filter((c) => typeof c === "string" && c.trim())
        .slice(0, 6)
    );
    const photoUrls = Array.isArray(listing.imageUrls) ? listing.imageUrls : [];
    setImportInfo({
      host,
      notes: Array.isArray(listing.sourceNotes) ? listing.sourceNotes.slice(0, 6) : [],
      photoCount: 0,
      photosTotal: photoUrls.length,
      photosLoading: photoUrls.length > 0,
      addressNeedsConfirm: marked.has("address"),
      batchDone: importBatch.current.done,
      batchTotal: importBatch.current.total,
      nextName: queue[0]?.name ?? null,
    });
    setImportedPhotoUrls(photoUrls);
    if (photoUrls.length) importPhotos(photoUrls);

    // Jump to the first gap. Steps the import satisfied count as visited so
    // the progress bar honestly shows them done (endowed progress you earned).
    const importDone = new Set(["perks", "photos"]);
    if (listing.home_type) importDone.add("basics");
    if (listing.address) importDone.add("address");
    if (listing.description) importDone.add("description");
    setVisited((prev) => new Set([...prev, ...importDone]));
    const unitsOk =
      nextUnits.length > 0 &&
      nextUnits.every((u) => u.bedrooms !== "" && u.bathrooms !== "") &&
      nextUnits.every((u) => (u.leaseTermMonths ?? []).length > 0);
    const firstGap = !listing.address
      ? "address"
      : !listing.home_type
      ? "basics"
      : !unitsOk
      ? "units"
      : !listing.description
      ? "description"
      : "review";
    // Address confirm matters even when imported — landlords land on it first
    // when it needs the one-tap dropdown confirmation.
    setStepId(listing.address && marked.has("address") ? "address" : firstGap);
    setError(null);
  };

  // --------------------------------------------------------------- navigation
  const stepIndex = STEPS.findIndex((s) => s.id === stepId);

  const existingProperty = propertyLookup?.property ?? null;
  const attachingToExistingUnit =
    unitSelection.mode === "existing" && !!unitSelection.unitId;

  const lookupProperty = useCallback(async (address) => {
    if (!address?.trim()) return;
    setLookupLoading(true);
    try {
      const res = await fetch(
        `/api/properties/lookup?address=${encodeURIComponent(address)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setPropertyLookup(data);
      setUnitSelection({ mode: data?.property ? "existing" : "new", unitId: null });
    } catch (err) {
      console.error("Property lookup error:", err);
    } finally {
      setLookupLoading(false);
    }
  }, []);

  /*
   * The earliest day any apartment on offer opens up. Availability belongs to
   * the lease, so it is collected per apartment on the units step — this only
   * summarises it for the property row.
   */
  const earliestUnitAvailability = () => {
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const dates = [];
    for (const u of units.filter((u) => u.available !== false)) {
      const numbers = String(u.unitNumbers ?? "")
        .split(/[,\s]+/)
        .filter(Boolean);
      const values = numbers.length
        ? numbers.map((n) => (u.unitAvailability ?? {})[n] || "")
        : [u.availableFrom ?? ""];
      // A blank means available now, which beats every date on the page.
      if (values.some((d) => !ISO_DATE.test(d))) return null;
      dates.push(...values);
    }
    return dates.sort()[0] ?? null;
  };

  const validateStep = (id) => {
    if (id === "address") {
      if (!form.address.trim()) return "Enter the property address to continue.";
      if (existingProperty && unitSelection.mode === "existing" && !unitSelection.unitId)
        return "Pick which unit this lease is for, or choose to add a new unit.";
    }
    if (id === "units") {
      if (units.length === 0) return "Add at least one unit.";
      if (units.some((u) => u.bedrooms === "" || u.bathrooms === ""))
        return "Each unit needs bedrooms and bathrooms.";
      if (
        units.some(
          (u) =>
            u.available !== false &&
            !(Array.isArray(u.leaseTermMonths) && u.leaseTermMonths.length > 0)
        )
      )
        return "Pick at least one lease term for each available unit.";
      /*
       * Attaching to an existing unit creates ONE offering on that one unit, so
       * only the first card is submitted. Say so rather than accepting extra
       * cards and dropping them silently.
       */
      if (attachingToExistingUnit && units.length > 1) {
        return "You're adding your listing to one existing unit, so keep a single unit here. Choose “add a new unit” to list several.";
      }
      // Attaching to an existing unit reuses that unit's identity, so the
      // floor-plan cards aren't creating anything that needs identifying.
      if (!attachingToExistingUnit) {
        if (units.some((u) => !u.numbersUnknown && !u.designator))
          return "Pick a unit type for each floor plan (or “Whole property” for a house).";
        if (
          units.some(
            (u) =>
              !u.numbersUnknown &&
              parseUnitNumbers(u.designator, u.unitNumbers).length === 0
          )
        )
          return "List the unit numbers for each floor plan, e.g. 2W, 2E.";
        // Two cards claiming the same unit would create duplicate units at the
        // property — exactly the collision this model exists to prevent.
        const seen = new Set();
        for (const u of units) {
          for (const n of parseUnitNumbers(u.designator, u.unitNumbers)) {
            const key = `${u.designator}|${n ?? ""}`;
            if (seen.has(key))
              return `Unit ${u.designator} ${n ?? ""} is listed on more than one floor plan.`;
            seen.add(key);
          }
        }
      }
    }
    if (id === "description") {
      if (!form.description.trim()) return "A short description is required.";
      // No names, no links, no "contact us at" - the contact fields on this same
      // step are how students are meant to reach the landlord.
      const problem = checkListingDescription(form.description);
      if (problem) return problem;
    }
    return null;
  };

  const goTo = (id) => {
    setError(null);
    setStepId(id);
  };

  const next = () => {
    const problem = validateStep(stepId);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setVisited((prev) => new Set([...prev, stepId]));
    const idx = STEPS.findIndex((s) => s.id === stepId);
    if (idx < STEPS.length - 1) setStepId(STEPS[idx + 1].id);
  };

  const back = () => {
    setError(null);
    const idx = STEPS.findIndex((s) => s.id === stepId);
    if (idx > 0) setStepId(STEPS[idx - 1].id);
    else setStepId("start");
  };

  // ------------------------------------------------------------------ publish
  const publish = async () => {
    setFieldError(null);
    for (const s of STEPS) {
      const problem = validateStep(s.id);
      if (problem) {
        setError(problem);
        setStepId(s.id);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      // A card is a FLOOR PLAN; expand it into one payload row per physical unit
      // sharing it, so each gets its own identity and its own lease.
      const unitPayload = units.flatMap((u) => {
        const numbers = parseUnitNumbers(u.designator, u.unitNumbers);
        /*
         * A floor plan whose apartments were never named is still one unit, and
         * it goes in with no word in front, because the database allows a word
         * only alongside a number ("Unit 1508"), or "Whole" with no number, or
         * neither. "Whole" still arrives here as a single null number, so it
         * keeps its word.
         *
         * This is decided here rather than at import because a card can pick up
         * a word in front any number of ways: an import from before this was
         * understood and still sitting in the autosaved draft, or the landlord
         * choosing one from the dropdown and leaving the numbers empty. Fixing
         * it only at import left both of those publishing a shape the database
         * throws out, and the error a landlord sees for it is "could not save a
         * unit", which tells them nothing they can act on.
         */
        const unnamed = numbers.length === 0;
        return (unnamed ? [null] : numbers).map((number) => ({
          bedrooms: Number(u.bedrooms),
          bathrooms: Number(u.bathrooms),
          rent:
            number != null && u.unitRents?.[number] != null
              ? Number(u.unitRents[number])
              : u.rent !== ""
              ? Number(u.rent)
              : null,
          area: u.area !== "" ? Number(u.area) : null,
          available: u.available !== false,
          title: (u.title ?? "").trim() || null,
          floorPlanImageUrl: u.floorPlanImageUrl || null,
          leaseTermMonths: Array.isArray(u.leaseTermMonths)
            ? u.leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
            : [],
          /*
           * Every price this apartment is offered at, as its own unit_leases
           * row. The card's own rent and terms are the first; extraLeases are
           * the other lengths a revenue-managed building quotes. A per-apartment
           * rent overrides the card's, which is how two apartments on one floor
           * plan end up at $3,080 and $3,095.
           */
          leases: [
            {
              rent:
                (number != null && u.unitRents?.[number] != null
                  ? Number(u.unitRents[number])
                  : u.rent !== ""
                  ? Number(u.rent)
                  : null),
              leaseTermMonths: Array.isArray(u.leaseTermMonths)
                ? u.leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
                : [],
            },
            ...(u.extraLeases ?? [])
              .filter((l) => l && l.rent !== "" && l.rent != null)
              .map((l) => ({
                rent: Number(l.rent),
                leaseTermMonths: (l.leaseTermMonths ?? [])
                  .map(Number)
                  .filter((m) => Number.isFinite(m) && m > 0),
              })),
          ],
          designator: unnamed ? null : u.designator || null,
          number,
          /*
           * unit_leases.available_from, per apartment. The API has always taken
           * this and fallen back to the property-wide date; the import wizard
           * simply never sent it, so a building where one apartment frees up in
           * October and another in November published as if they were the same.
           */
          leaseAvailability:
            (number != null ? u.unitAvailability?.[number] : null) || u.availableFrom || null,
        }));
      });

      // The property and unit both already exist — only the caller's own lease
      // is created. The sublease guard is enforced by the database.
      const res = attachingToExistingUnit
        ? await fetch("/api/leases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              unitId: unitSelection.unitId,
              rent: units[0]?.rent !== "" ? Number(units[0]?.rent) : null,
              leaseTermMonths: Array.isArray(units[0]?.leaseTermMonths)
                ? units[0].leaseTermMonths
                    .map(Number)
                    .filter((m) => Number.isFinite(m) && m > 0)
                : [],
              sublease: String(form.lease_type).toLowerCase() === "sublease",
              available: units[0]?.available !== false,
              description: form.description,
              furnished: form.furnished,
              contactEmail: form.contact_email || null,
              contactPhone: form.contact_phone || null,
              contactName: form.contact_name || null,
            }),
          })
        : await fetch("/api/addListing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          unitTypes: unitPayload,
          customAmenities,
          concessions,
          // A property exists at this address and the user chose to add a new
          // unit to it — attach rather than create a second property row.
          ...(existingProperty ? { attachToListingId: existingProperty.id } : {}),
          // Availability is asked per apartment, and unit_leases.available_from
          // is what students filter on and what the listing page shows. The
          // property row carries the earliest of those so listings.move_in_date
          // still means something to anything reading it.
          moveInDate: earliestUnitAvailability(),
          // Where this came from, so the weekly source check can find it again.
          sourceUrl: importSourceUrl.current || null,
          indexUrl: importPastedUrl.current || null,
          contactEmail: form.contact_email || null,
          contactPhone: form.contact_phone || null,
          contactName: form.contact_name || null,
          ...(coords.lat != null && coords.lng != null
            ? { longitude: coords.lng, latitude: coords.lat }
            : {}),
          attachStreetView: !streetViewDeleted && stagedFiles.length === 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        /*
         * A `field` rejection is fixable at exactly one input, and that input is
         * on an earlier step. Send the landlord back to it rather than printing
         * a message on Review beside a control that cannot resolve it.
         */
        if (data.field === "title") {
          setFieldError({
            field: "title",
            message: data.error || "That value is already in use.",
            conflict: data.conflict ?? null,
          });
          goTo("description");
        } else if (data.field) {
          setFieldError({
            field: data.field,
            message: data.error || "That value is already in use.",
            conflict: data.conflict ?? null,
          });
        } else {
          setError(data.error || "Something went wrong.");
        }
        return;
      }

      // Upload staged images via presigned URLs (browser -> R2 directly).
      // A photo failure never un-saves the listing, so in queue mode it must
      // not hold the remaining properties hostage: toast it and keep going.
      let uploadError = null;
      if (stagedFiles.length > 0) {
        /*
         * The two submit paths return different shapes: /api/addListing gives
         * back `listing`, /api/leases gives back `lease: { id, listingId }`.
         * Reading only `data.listing.id` meant every photo added while
         * attaching an offering to an existing unit was dropped on the floor —
         * the block below was skipped entirely, with no upload and no error.
         */
        const listingId = data.listing?.id ?? data.lease?.listingId ?? null;
        /*
         * Attaching an offering to an existing unit means these photos are of
         * that APARTMENT, not of a building the uploader may not even own. They
         * are filed against the unit, which is also the only scope they are
         * allowed to write to — /api/upload reserves property photos for the
         * property owner, so sending these unscoped would now be rejected.
         */
        const photoUnitId = attachingToExistingUnit ? unitSelection.unitId : null;
        if (listingId) {
          const presignRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              listingId,
              unitId: photoUnitId,
              files: stagedFiles.map((f) => ({ name: f.name, type: f.type })),
            }),
          });
          if (!presignRes.ok) {
            const presignData = await presignRes.json().catch(() => ({}));
            uploadError = `Listing saved, but images failed to upload: ${
              presignData.error || `server error ${presignRes.status}`
            }`;
          } else {
            const { presigned } = await presignRes.json();
            const uploadResults = await Promise.allSettled(
              stagedFiles.map((file, i) =>
                fetch(presigned[i].uploadUrl, {
                  method: "PUT",
                  body: file,
                  headers: { "Content-Type": file.type },
                })
              )
            );
            const failed = uploadResults.filter(
              (r) => r.status === "rejected" || !r.value?.ok
            );
            if (failed.length > 0) {
              uploadError = `Listing saved, but ${failed.length} image(s) failed to upload. You can re-add them from your dashboard.`;
            } else {
              const confirmRes = await fetch("/api/upload", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  listingId,
                  unitId: photoUnitId,
                  urls: presigned.map((p) => p.publicUrl),
                }),
              });
              if (!confirmRes.ok) {
                const confirmData = await confirmRes.json().catch(() => ({}));
                uploadError = `Listing saved, but images could not be attached: ${
                  confirmData.error || `server error ${confirmRes.status}`
                }`;
              }
            }
          }
        } else {
          uploadError =
            "Saved, but your photos could not be attached. You can add them from your dashboard.";
        }
      }
      // The listing exists either way — staying on the form would invite a
      // duplicate publish. Toast the failure and complete the flow; the
      // dashboard is where photos get re-added.
      if (uploadError) toast.error(uploadError, { duration: 8000 });

      // Contact info different from the profile? Hand the diff to onSuccess.
      const diff = {};
      const trim = (v) => (v ?? "").trim();
      if (trim(form.contact_name) && trim(form.contact_name) !== trim(user?.name))
        diff.name = trim(form.contact_name);
      if (trim(form.contact_email) && trim(form.contact_email) !== trim(user?.email))
        diff.email = trim(form.contact_email);
      if (trim(form.contact_phone) && trim(form.contact_phone) !== trim(user?.phone))
        diff.phone = trim(form.contact_phone);

      clearAutosave();

      // Multi-property import: load the next queued property instead of leaving.
      if (importQueue.length > 0) {
        await advanceImportQueue(unitPayload, Object.keys(diff).length ? diff : null);
        return;
      }
      await onSuccess(unitPayload, Object.keys(diff).length ? diff : null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const advanceImportQueue = async (unitPayload, diff) => {
    let queue = importQueue;
    toast.success("Listing published!");
    // Anything still downloading belongs to the listing we just published.
    cancelImportAssets();
    // fresh form for the next property
    setForm(blankForm(user));
    setUnits([emptyUnit()]);
    setCustomAmenities([]);
    setConcessions([]);
    stagedPreviews.forEach((u) => URL.revokeObjectURL(u));
    setStagedFiles([]);
    stagedPhotoUrls.current = new Set();
    setStagedPreviews([]);
    setStreetView({ available: false, url: null });
    setStreetViewDeleted(false);
    setCoords({ lat: null, lng: null });
    setImportedFields(new Set());
    setVisited(new Set());
    while (queue.length) {
      const target = queue[0];
      queue = queue.slice(1);
      setImportQueue(queue);
      setImportInfo({ loadingNext: target.name });
      setStepId("start");
      try {
        const pre = prefetchRef.current;
        prefetchRef.current = null;
        const data = pre && pre.name === target.name ? await pre.promise : null;
        const resolved = data ?? (await requestQueuedDraft(target));
        applyDraft(resolved.listing, {
          sourceUrl: resolved.sourceUrl,
          pastedUrl: importPastedUrl.current,
          queue,
          isQueueAdvance: true,
        });
        return;
      } catch (err) {
        // A 429 from the hourly limiter, a 5xx, or a dropped connection is not
        // "this property is unreadable" — it will hit the next property too.
        // Skipping on it walked the entire remaining queue in one loop, firing
        // a red toast per property and then navigating away, so a landlord who
        // queued 30 properties lost 29 of them with no explanation. Stop on the
        // first non-specific failure and say what actually happened.
        const status = err?.status;
        const throttled = status === 429;
        if (throttled || status == null || status >= 500) {
          const left = queue.length + 1;
          toast.error(
            throttled
              ? `Import limit reached — ${left} propert${
                  left === 1 ? "y" : "ies"
                } not imported. Paste your site again in an hour to finish them.`
              : `Import stopped after a connection problem — ${left} propert${
                  left === 1 ? "y" : "ies"
                } not imported. Paste your site again to finish them.`,
            { duration: 9000 }
          );
          break;
        }
        toast.error(`Couldn't import ${target.name}, skipping it.`);
      }
    }
    prefetchRef.current = null;
    setImportQueue([]);
    setImportInfo(null);
    importBatch.current = { done: 0, total: 0 };
    await onSuccess(unitPayload, diff);
  };

  // ------------------------------------------------------------------- render
  const w = {
    user,
    form,
    setField,
    toggleMulti,
    units,
    addUnit,
    removeUnit,
    updateUnit,
    toggleUnitTerm,
    mirrorTerms,
    clearTermsExcept,
    addExtraLease,
    removeExtraLease,
    updateExtraLease,
    toggleExtraLeaseTerm,
    customAmenities,
    addCustomAmenity,
    removeCustomAmenity,
    stagedFiles,
    stagedPreviews,
    handleImageFiles,
    removeStagedImage,
    reorderStagedPhotos,
    removeStagedByUrl,
    coords,
    setCoords,
    streetView,
    streetViewDeleted,
    setStreetViewDeleted,
    streetViewLoading,
    fetchStreetViewPreview,
    propertyLookup,
    lookupLoading,
    lookupProperty,
    existingProperty,
    unitSelection,
    setUnitSelection,
    attachingToExistingUnit,
    importedFields,
    clearImported,
    importInfo,
    importQueue,
    applyDraft,
    stepComplete,
    goTo,
    startFresh,
    error,
    fieldError,
    submitting,
    publish,
  };

  const renderStep = () => {
    switch (stepId) {
      case "start":
        return (
          <StepStart
            key={importBoxKey}
            w={w}
            initialImportUrl={importSeed}
          />
        );
      case "address":
        return <StepAddress w={w} />;
      case "basics":
        return <StepBasics w={w} />;
      case "units":
        return <StepUnits w={w} />;
      case "perks":
        return <StepPerks w={w} />;
      case "photos":
        return <StepPhotos w={w} />;
      case "description":
        return <StepDescription w={w} />;
      case "review":
        return <StepReview w={w} />;
      default:
        return null;
    }
  };

  const onStart = stepId === "start";
  const nextLabel =
    stepId === "photos" && stagedFiles.length === 0 && !streetView.available
      ? "Skip for now"
      : "Next";

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-8">
      {/* Queue-advance interstitial */}
      {importInfo?.loadingNext ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="flex items-center gap-3 text-sm text-gray-700">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-red-600" />
            Loading the next property: {importInfo.loadingNext}…
          </div>
          <p className="text-xs text-gray-400">
            Reading its page now, usually under a minute.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Progress header (hidden on the start screen) */}
          {!onStart && (
            <div className="border-b border-gray-100 px-6 pb-4 pt-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-500">
                  Step {stepIndex + 1} of {STEPS.length}
                  <span className="mx-1.5 text-gray-300">·</span>
                  {STEPS[stepIndex]?.label}
                  {importInfo?.batchTotal > 1 && (
                    <>
                      <span className="mx-1.5 text-gray-300">·</span>
                      Property {importInfo.batchDone} of {importInfo.batchTotal}
                    </>
                  )}
                </p>
                <p className="text-[11px] text-gray-400">Progress saves automatically</p>
              </div>
              <div className="mt-2.5 flex gap-1.5">
                {STEPS.map((s, i) => {
                  const done = stepComplete(s.id) || i < stepIndex;
                  const reachable = i <= stepIndex || done;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      title={s.label}
                      onClick={() => reachable && goTo(s.id)}
                      className={`h-1.5 flex-1 rounded-full transition-colors ${
                        s.id === stepId
                          ? "bg-red-600"
                          : done
                          ? "bg-red-300 hover:bg-red-400"
                          : "bg-gray-200"
                      } ${reachable ? "cursor-pointer" : "cursor-default"}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <div className="px-6 py-6">
            {resumed && onStart && (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <span>Picked up where you left off.</span>
                <button
                  type="button"
                  onClick={startFresh}
                  className="font-medium text-red-600 hover:underline"
                >
                  Start fresh
                </button>
              </div>
            )}
            {renderStep()}
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Nav footer (start + review render their own primary actions) */}
          {!onStart && stepId !== "review" && (
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={back}
                className="text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={next}
                className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                {nextLabel}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-center gap-4 text-center">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Save & exit
        </button>
        {!onStart && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Throw away this draft and start over?")) startFresh();
            }}
            className="text-xs text-gray-400 hover:text-red-600"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}
