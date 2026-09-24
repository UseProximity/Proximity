"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import {
  emptyLease,
  emptyUnit,
  mergeWithLive,
  normalizeWizardUnit,
} from "@/components/listings/listingFormOptions";
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
  { id: "units", label: "Units & leases" },
  { id: "perks", label: "Amenities" },
  { id: "photos", label: "Photos" },
  { id: "description", label: "Description" },
  { id: "review", label: "Review" },
];

// Matches MAX_LEASES_PER_UNIT in /api/addListing.
const MAX_LEASES_PER_UNIT = 40;

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

/*
 * `batch` is set when this wizard is one tab of a multi-property import (see
 * ImportBatch): { tabKey, draft, sourceUrl, pastedUrl, existing, onRegister }.
 * The tab never shows the start screen, saves its own draft under its own key,
 * and is published by the workspace's "Publish all" rather than its own button.
 * `existing` is set when the property is already on Proximity: the landlord adds
 * units to that listing and edits the leases they already hold there.
 */
export default function AddListingWizard({
  user,
  onClose,
  onSuccess,
  initialImportUrl = "",
  onImportMany,
  batch = null,
}) {
  const [stepId, setStepId] = useState(batch ? "address" : "start"); // "start" | STEPS ids
  const autosaveKey = batch
    ? `proximity:add-listing-batch-tab:${user?.id ?? "anon"}:${batch.tabKey}`
    : AUTOSAVE_KEY(user?.id);
  const batchExisting = batch?.existing ?? null;
  /*
   * On a property already on Proximity: changes to leases this landlord already
   * holds there (lease id -> changed fields), and new leases they are adding to
   * units that already exist (unit id -> leases). Both are sent on publish.
   */
  const [existingEdits, setExistingEdits] = useState({});
  const [existingNewLeases, setExistingNewLeases] = useState({});
  /*
   * The landlord's OWN listing at this address (they own it, or hold leases on
   * it). Its live units and leases become the starting point of the units step,
   * with the website laid over them (see mergeWithLive); `liveMergedFor` records
   * which listing that was done for, so a reload does not do it twice.
   */
  const ownExisting = batchExisting?.mine ? batchExisting : null;
  const [liveMergedFor, setLiveMergedFor] = useState(null);
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
      const raw = localStorage.getItem(autosaveKey);
      if (!raw) {
        // A tab with nothing saved yet starts from the draft the workspace read.
        if (batch?.draft) {
          applyDraft(batch.draft, { sourceUrl: batch.sourceUrl, pastedUrl: batch.pastedUrl });
          if (batchExisting) lookupProperty(batchExisting.address || batch.draft.address);
        }
        return;
      }
      const saved = JSON.parse(raw);
      const hasContent =
        saved?.form &&
        (saved.form.address?.trim() ||
          saved.form.description?.trim() ||
          (saved.units ?? []).some(
            (u) =>
              u.bedrooms !== "" ||
              (u.rent ?? "") !== "" ||
              (u.leases ?? []).some((l) => l.rent !== "")
          ));
      if (!hasContent) return;
      setForm({ ...blankForm(user), ...saved.form });
      importSourceUrl.current = saved.importSourceUrl ?? null;
      importPastedUrl.current = saved.importPastedUrl ?? null;
      setExistingEdits(saved.existingEdits ?? {});
      setExistingNewLeases(saved.existingNewLeases ?? {});
      setLiveMergedFor(saved.liveMergedFor ?? null);
      if (batchExisting) lookupProperty(batchExisting.address || saved.form.address);
      // Older drafts hold floor-plan cards with apartment lists; this turns
      // them into units with their leases underneath, merged by rent.
      setUnits(saved.units?.length ? saved.units.map(normalizeWizardUnit) : [emptyUnit()]);
      setCustomAmenities(saved.customAmenities ?? []);
      setCoords(saved.coords ?? { lat: null, lng: null });
      if (saved.stepId && saved.stepId !== "start") setStepId(saved.stepId);
      else if (batch) setStepId("address");
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
        autosaveKey,
        JSON.stringify({
          form,
          // Kept with the draft so a reload still publishes where it came from.
          importSourceUrl: importSourceUrl.current,
          importPastedUrl: importPastedUrl.current,
          existingEdits,
          existingNewLeases,
          liveMergedFor,
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
  }, [
    form,
    units,
    customAmenities,
    coords,
    stepId,
    visited,
    importedPhotoUrls,
    existingEdits,
    existingNewLeases,
    liveMergedFor,
    autosaveKey,
  ]);

  const clearAutosave = () => {
    try {
      localStorage.removeItem(autosaveKey);
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
  // ---- leases under a unit ----------------------------------------------
  const patchUnit = (i, fn) =>
    setUnits((u) => u.map((unit, idx) => (idx === i ? fn(unit) : unit)));

  const addLease = (i) =>
    patchUnit(i, (unit) => ({ ...unit, leases: [...(unit.leases ?? []), emptyLease()] }));

  const removeLease = (i, k) =>
    patchUnit(i, (unit) => {
      const rest = (unit.leases ?? []).filter((_, idx) => idx !== k);
      return { ...unit, leases: rest.length ? rest : [emptyLease()] };
    });

  const updateLease = (i, k, patch) => {
    clearImported(`u${i}:leases`);
    patchUnit(i, (unit) => ({
      ...unit,
      leases: (unit.leases ?? []).map((l, idx) => (idx === k ? { ...l, ...patch } : l)),
    }));
  };

  /*
   * Lease lengths are nearly always the same across a building, so one pick can
   * set them on every lease of every floor plan. Returns what was there so the
   * step can offer an undo: a bulk edit nobody can take back is worse than the
   * typing it saves.
   */
  const applyTermsToAll = (months) => {
    const before = units;
    setUnits((u) =>
      u.map((unit) => ({
        ...unit,
        leases: (unit.leases ?? []).map((l) => ({ ...l, leaseTermMonths: [...months] })),
      }))
    );
    return before;
  };
  const restoreUnits = (snapshot) => setUnits(snapshot);

  // ---- the landlord's own listing: what is live, and changes to it --------
  const setUnitRetire = (i, retire) => patchUnit(i, (u) => ({ ...u, retire }));
  const setLeaseRetire = (i, k, retire) =>
    patchUnit(i, (u) => ({
      ...u,
      leases: u.leases.map((l, idx) => (idx === k ? { ...l, retire } : l)),
    }));
  // Back to what is on Proximity now, for one lease or one unit field.
  const revertLease = (i, k) =>
    patchUnit(i, (u) => ({
      ...u,
      leases: u.leases.map((l, idx) =>
        idx === k && l.live
          ? {
              ...l,
              rent: l.live.rent,
              rentIsPerPerson: l.live.rentIsPerPerson,
              availableFrom: l.live.availableFrom,
              leaseTermMonths: l.live.leaseTermMonths,
            }
          : l
      ),
    }));
  const revertUnitField = (i, field) =>
    patchUnit(i, (u) => (u.live ? { ...u, [field]: u.live[field] } : u));

  // ---- a property already on Proximity -----------------------------------
  const editExistingLease = (leaseId, patch) =>
    setExistingEdits((prev) => ({ ...prev, [leaseId]: { ...(prev[leaseId] ?? {}), ...patch } }));
  const resetExistingLease = (leaseId) =>
    setExistingEdits((prev) => {
      const next = { ...prev };
      delete next[leaseId];
      return next;
    });
  const addExistingUnitLease = (unitId) =>
    setExistingNewLeases((prev) => ({ ...prev, [unitId]: [...(prev[unitId] ?? []), emptyLease()] }));
  const updateExistingUnitLease = (unitId, k, patch) =>
    setExistingNewLeases((prev) => ({
      ...prev,
      [unitId]: (prev[unitId] ?? []).map((l, idx) => (idx === k ? { ...l, ...patch } : l)),
    }));
  const removeExistingUnitLease = (unitId, k) =>
    setExistingNewLeases((prev) => ({
      ...prev,
      [unitId]: (prev[unitId] ?? []).filter((_, idx) => idx !== k),
    }));

  /*
   * Photos of one unit. Uploaded as soon as they are picked, like the floor
   * plan, so they survive a reload; filed against the unit after publish, once
   * it has an id.
   */
  const [unitPhotoUploading, setUnitPhotoUploading] = useState({});
  const uploadUnitPhotos = async (i, fileList) => {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setFloorPlanError((p) => ({ ...p, [`photos${i}`]: null }));
    setUnitPhotoUploading((p) => ({ ...p, [i]: (p[i] ?? 0) + files.length }));
    let failed = 0;
    await Promise.all(
      files.map(async (file) => {
        try {
          const upload = await compressImage(file);
          if (upload.size > 4 * 1024 * 1024) throw new Error("too big");
          const fd = new FormData();
          fd.append("file", upload);
          fd.append("kind", "unit-photo");
          const res = await fetch("/api/upload/floor-plan", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.url) throw new Error("upload failed");
          setUnits((us) =>
            us.map((u, idx) => (idx === i ? { ...u, photos: [...(u.photos ?? []), data.url] } : u))
          );
        } catch {
          failed += 1;
        } finally {
          setUnitPhotoUploading((p) => ({ ...p, [i]: Math.max(0, (p[i] ?? 1) - 1) }));
        }
      })
    );
    if (failed)
      setFloorPlanError((p) => ({
        ...p,
        [`photos${i}`]: `${failed} photo${failed === 1 ? "" : "s"} didn't upload. Try again.`,
      }));
  };
  const removeUnitPhoto = (i, url) =>
    setUnits((us) =>
      us.map((u, idx) => (idx === i ? { ...u, photos: (u.photos ?? []).filter((p) => p !== url) } : u))
    );

  /*
   * A floor plan the landlord uploads for a unit. Same endpoint the import uses
   * for the diagrams it finds: the file goes to R2 now and the unit keeps only
   * its URL, so it survives a reload like everything else in the draft. Photos
   * are compressed first because a request body over 4.5 MB never reaches the
   * route; a PDF cannot be, so an oversized one is refused here with a reason.
   */
  const [floorPlanUploading, setFloorPlanUploading] = useState({});
  const [floorPlanError, setFloorPlanError] = useState({});
  const uploadFloorPlan = async (i, file) => {
    if (!file) return;
    setFloorPlanError((p) => ({ ...p, [i]: null }));
    const isPdf = file.type === "application/pdf";
    if (!isPdf && !file.type.startsWith("image/")) {
      setFloorPlanError((p) => ({ ...p, [i]: "Use an image or a PDF." }));
      return;
    }
    const upload = isPdf ? file : await compressImage(file);
    if (upload.size > 4 * 1024 * 1024) {
      setFloorPlanError((p) => ({ ...p, [i]: "That file is over 4 MB. Try a smaller one." }));
      return;
    }
    setFloorPlanUploading((p) => ({ ...p, [i]: true }));
    try {
      const fd = new FormData();
      fd.append("file", upload);
      const res = await fetch("/api/upload/floor-plan", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
      updateUnit(i, "floorPlanImageUrl", data.url);
    } catch {
      setFloorPlanError((p) => ({ ...p, [i]: "The upload didn't go through. Try again." }));
    } finally {
      setFloorPlanUploading((p) => ({ ...p, [i]: false }));
    }
  };

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
                (u.leases ?? []).every((l) => (l.leaseTermMonths ?? []).length > 0)
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
        for (const fld of ["bedrooms", "bathrooms", "area", "title"]) {
          if (u[fld] != null && u[fld] !== "") marked.add(`u${i}:${fld}`);
        }
        if ((u.rent != null && u.rent !== "") || (u.leaseTermMonths ?? []).length)
          marked.add(`u${i}:leases`);
        if (u.floorPlanImageUrl) floorPlanImports.push({ index: i, url: u.floorPlanImageUrl });
        /*
         * The site's own unit identifiers ("2W", "101", "Madrid") fill in the
         * "which units have this floor plan?" boxes, so each one becomes its
         * own listing_units row with its own lease. They used to have nowhere
         * to go and were landing in the floor-plan name box instead.
         */
        const names = (u.unitNames ?? []).filter((n) => typeof n === "string" && n.trim());
        // Lease lengths the site offers on this floor plan, straight onto the
        // chips. RealPage properties publish these per floor plan in their
        // availability feed, which is the only place they exist.
        const terms = [...new Set((u.leaseTermMonths ?? []).filter((m) => Number.isFinite(m) && m > 0))]
          .sort((a, b) => a - b);
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
        const cheapest = curve.length ? curve.reduce((a, b) => (a.rent <= b.rent ? a : b)) : null;
        /*
         * Read in the floor-plan-card shape the parsing above has always
         * produced, then folded by normalizeWizardUnit into one unit with a
         * lease per distinct rent. Apartments at the same price on the same
         * plan become one lease; the plan's other prices become the others.
         */
        return normalizeWizardUnit({
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
        });
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
      nextUnits.every((u) => u.leases.every((l) => l.leaseTermMonths.length > 0));
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
    // On the landlord's own listing, ask for that one row only: its units are
    // what the units step edits, not the union of every duplicate here.
    const only = batchExisting?.mine ? `&listingId=${encodeURIComponent(batchExisting.id)}` : "";
    try {
      const res = await fetch(
        `/api/properties/lookup?address=${encodeURIComponent(address)}${only}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setPropertyLookup(data);
      // An existing-property tab edits that property's units on the units step,
      // so its new units always attach to the property as new units.
      setUnitSelection({
        mode: data?.property && !batchExisting ? "existing" : "new",
        unitId: null,
      });
    } catch (err) {
      console.error("Property lookup error:", err);
    } finally {
      setLookupLoading(false);
    }
  }, [batchExisting]);

  /*
   * The tab learned after it opened that this address is already on Proximity
   * (publishing was refused as a duplicate): load that listing now.
   */
  const seenExistingId = useRef(batchExisting?.id ?? null);
  useEffect(() => {
    const id = batchExisting?.id ?? null;
    if (!id || id === seenExistingId.current) return;
    seenExistingId.current = id;
    lookupProperty(batchExisting.address || form.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchExisting?.id]);

  // Start the landlord's own listing from what is live, website on top.
  useEffect(() => {
    if (!ownExisting || !existingProperty) return;
    if (existingProperty.id !== ownExisting.id || liveMergedFor === ownExisting.id) return;
    setUnits((current) => mergeWithLive(current, existingProperty.units ?? []));
    setLiveMergedFor(ownExisting.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownExisting?.id, existingProperty?.id]);

  /*
   * The earliest day any apartment on offer opens up. Availability belongs to
   * the lease, so it is collected per apartment on the units step — this only
   * summarises it for the property row.
   */
  const earliestUnitAvailability = () => {
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const dates = [];
    for (const u of units.filter((u) => u.available !== false)) {
      for (const l of u.leases ?? []) {
        // A blank means available now, which beats every date on the page.
        if (!ISO_DATE.test(l.availableFrom ?? "")) return null;
        dates.push(l.availableFrom);
      }
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
      if (batchExisting) {
        const newOnExisting = Object.values(existingNewLeases).flat();
        if (newOnExisting.some((l) => !(l.leaseTermMonths ?? []).length))
          return "Pick at least one lease length for each lease you're adding to an existing unit.";
        if (
          units.length === 0 &&
          !newOnExisting.length &&
          !Object.keys(existingEdits).length
        )
          return "Add a unit, add a lease to one of the existing units, or change one of your leases.";
      } else if (units.length === 0) return "Add at least one unit.";
      if (units.some((u) => u.bedrooms === "" || u.bathrooms === ""))
        return "Each unit needs bedrooms and bathrooms.";
      const unitName = (u, i) => u.title?.trim() || `Unit ${i + 1}`;
      for (const [i, u] of units.entries()) {
        if (u.available === false || u.retire) continue;
        // Anything being marked unavailable is not being offered, so it needs
        // no lease length to publish.
        const leases = (u.leases ?? []).filter((l) => !l.retire);
        if (leases.some((l) => !(l.leaseTermMonths ?? []).length))
          return `Pick at least one lease length for every lease on ${unitName(u, i)}.`;
        /*
         * One lease per rent on a unit. Two at the same price are one option
         * to a student, so ask for them to be combined rather than publishing
         * the same line twice.
         */
        const rents = leases.map((l) => (l.rent === "" ? "" : Number(l.rent)));
        const dupe = rents.find((r, k) => rents.indexOf(r) !== k);
        if (dupe !== undefined)
          return dupe === ""
            ? `${unitName(u, i)} has two leases with no rent. Combine them into one.`
            : `${unitName(u, i)} has two leases at $${dupe}. Combine them into one lease with both lease lengths.`;
        if (leases.length > MAX_LEASES_PER_UNIT)
          return `${unitName(u, i)} has more than ${MAX_LEASES_PER_UNIT} leases. Remove some to publish.`;
      }
      /*
       * Attaching to an existing unit creates offerings on that one unit, so
       * only the first unit is submitted. Say so rather than accepting extra
       * units and dropping them silently.
       */
      if (attachingToExistingUnit && units.length > 1) {
        return "You're adding your listing to one existing unit, so keep a single unit here. Choose “add a new unit” to list several.";
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
    else if (!batch) setStepId("start");
  };

  // ------------------------------------------------------------------ publish
  // The first thing standing between this draft and publishing, if any.
  const firstProblem = () => {
    for (const s of STEPS) {
      const problem = validateStep(s.id);
      if (problem) return { stepId: s.id, problem };
    }
    return null;
  };
  const showProblem = (p) => {
    setError(p.problem);
    setStepId(p.stepId);
  };

  /*
   * Everything publishing does, short of leaving the page. Returns
   * { ok, listingId, unitPayload, diff } or { ok: false, error }, so the
   * single-listing button and the workspace's "Publish all" share one path.
   */
  const submitListing = async () => {
    setFieldError(null);
    const problem = firstProblem();
    if (problem) {
      showProblem(problem);
      return { ok: false, error: problem.problem };
    }
    setSubmitting(true);
    setError(null);
    try {
      /*
       * On a property already on Proximity, the landlord's changes to what they
       * already hold there go first: edited leases, then new leases on units
       * that already exist. New units, if any, attach to the listing below.
       */
      /*
       * The landlord's own listing: bring what is live in line with the units
       * step. Unit details (owner only), then each of their leases: changed
       * fields, retired ones marked unavailable, new ones added to the unit.
       * Units that are new altogether are created below like any others.
       */
      let createUnits = units;
      if (ownExisting) {
        const lid = ownExisting.id;
        const send = async (url, method, body, fallback) => {
          const res = await fetch(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) return null;
          const d = await res.json().catch(() => ({}));
          return d.error || fallback;
        };
        const sameTerms = (a, b) =>
          JSON.stringify([...(a ?? [])].map(Number).sort()) ===
          JSON.stringify([...(b ?? [])].map(Number).sort());
        for (const u of units.filter((x) => x.live)) {
          const label = u.title || "a unit";
          if (ownExisting.mine === "owner") {
            const patch = {};
            for (const f of ["bedrooms", "bathrooms", "area", "title", "floorPlanImageUrl"])
              if (String(u[f] ?? "") !== String(u.live[f] ?? "")) patch[f] = u[f];
            if (Object.keys(patch).length) {
              const problem = await send(
                `/api/landlord/listings/${lid}/units/${u.live.id}`,
                "PATCH",
                patch,
                `Could not update ${label}.`
              );
              if (problem) {
                setError(problem);
                return { ok: false, error: problem };
              }
            }
          }
          for (const l of u.leases ?? []) {
            const off = !!(l.retire || u.retire || u.available === false);
            if (l.live) {
              const body = {};
              if (String(l.rent ?? "") !== String(l.live.rent ?? ""))
                body.rent = l.rent === "" ? null : Number(l.rent);
              if (!!l.rentIsPerPerson !== !!l.live.rentIsPerPerson)
                body.rentIsPerPerson = !!l.rentIsPerPerson;
              if ((l.availableFrom || "") !== (l.live.availableFrom || ""))
                body.availableFrom = l.availableFrom || null;
              if (!sameTerms(l.leaseTermMonths, l.live.leaseTermMonths))
                body.leaseTermMonths = (l.leaseTermMonths ?? []).map(Number);
              if (off !== !!l.live.unavailable) body.unavailable = off;
              if (!Object.keys(body).length) continue;
              const problem = await send(
                `/api/leases/${l.live.id}`,
                "PATCH",
                body,
                `Could not update a lease on ${label}.`
              );
              if (problem) {
                setError(problem);
                return { ok: false, error: problem };
              }
            } else {
              const payload = {
                  unitId: u.live.id,
                  rent: l.rent === "" ? null : Number(l.rent),
                  rentIsPerPerson: !!l.rentIsPerPerson,
                  leaseTermMonths: (l.leaseTermMonths ?? []).map(Number),
                  availableFrom: l.availableFrom || null,
                  sublease: String(form.lease_type).toLowerCase() === "sublease",
                  available: !off,
                  description: form.description,
                  furnished: form.furnished,
                  contactEmail: form.contact_email || null,
                  contactPhone: form.contact_phone || null,
                  contactName: form.contact_name || null,
              };
              const res = await fetch("/api/leases", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) {
                const problem = d.error || `Could not add a lease to ${label}.`;
                setError(problem);
                return { ok: false, error: problem };
              }
              /*
               * Recorded as live straight away, so if something later in this
               * publish fails, pressing Publish again edits this lease rather
               * than adding a second copy of it.
               */
              const saved = {
                id: d.lease?.id,
                rent: l.rent,
                rentIsPerPerson: !!l.rentIsPerPerson,
                availableFrom: l.availableFrom || "",
                leaseTermMonths: l.leaseTermMonths ?? [],
                unavailable: off,
              };
              if (saved.id) {
                setUnits((prev) =>
                  prev.map((pu) =>
                    pu !== u
                      ? pu
                      : {
                          ...pu,
                          leases: pu.leases.map((pl) =>
                            pl === l ? { ...pl, live: saved, status: "live" } : pl
                          ),
                        }
                  )
                );
              }
            }
          }
          if ((u.photos ?? []).length) {
            await send(
              "/api/upload",
              "PUT",
              { listingId: lid, unitId: u.live.id, urls: u.photos },
              null
            );
          }
        }
        createUnits = units.filter((x) => !x.live);
        if (!createUnits.length) {
          clearAutosave();
          return { ok: true, listingId: lid, unitPayload: [], diff: null };
        }
      } else if (batchExisting && existingProperty) {
        const leaseBody = (l) => ({
          rent: l.rent !== "" && l.rent != null ? Number(l.rent) : null,
          rentIsPerPerson: !!l.rentIsPerPerson,
          leaseTermMonths: (l.leaseTermMonths ?? []).map(Number).filter((m) => m > 0),
          availableFrom: l.availableFrom || null,
        });
        for (const [leaseId, patch] of Object.entries(existingEdits)) {
          const res = await fetch(`/api/leases/${leaseId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(leaseBody(patch)),
          });
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            const message = d.error || "One of your existing leases could not be updated.";
            setError(message);
            return { ok: false, error: message };
          }
        }
        setExistingEdits({});
        for (const [unitId, leases] of Object.entries(existingNewLeases)) {
          for (const l of leases) {
            const res = await fetch("/api/leases", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                unitId,
                ...leaseBody(l),
                sublease: String(form.lease_type).toLowerCase() === "sublease",
                available: true,
                description: form.description,
                furnished: form.furnished,
                contactEmail: form.contact_email || null,
                contactPhone: form.contact_phone || null,
                contactName: form.contact_name || null,
              }),
            });
            if (!res.ok) {
              const d = await res.json().catch(() => ({}));
              const message = d.error || "A lease could not be added to an existing unit.";
              setError(message);
              return { ok: false, error: message };
            }
          }
        }
        setExistingNewLeases({});
        // Nothing new to create: the edits were the whole job.
        if (units.length === 0) {
          clearAutosave();
          return { ok: true, listingId: existingProperty.id, unitPayload: [], diff: null };
        }
      }

      /*
       * One unit per floor plan, with its leases underneath. A house typed in
       * as a single unit is the whole property; anything else goes in with no
       * unit number, which listing_units allows.
       */
      const wholeProperty = createUnits.length === 1 && form.home_type !== "apartment";
      const termsOf = (l) =>
        (l.leaseTermMonths ?? []).map(Number).filter((m) => Number.isFinite(m) && m > 0);
      const unitPayload = createUnits.map((u) => {
        const leases = (u.leases ?? []).map((l) => ({
          rent: l.rent !== "" && l.rent != null ? Number(l.rent) : null,
          rentIsPerPerson: !!l.rentIsPerPerson,
          leaseTermMonths: termsOf(l),
          availableFrom: l.availableFrom || null,
        }));
        const priced = leases.map((l) => l.rent).filter((r) => r != null);
        const dates = leases.map((l) => l.availableFrom);
        return {
          bedrooms: Number(u.bedrooms),
          bathrooms: Number(u.bathrooms),
          rent: priced.length ? Math.min(...priced) : null,
          area: u.area !== "" ? Number(u.area) : null,
          available: u.available !== false,
          title: (u.title ?? "").trim() || null,
          floorPlanImageUrl: u.floorPlanImageUrl || null,
          // Every length offered on this unit, for the listing's summary.
          leaseTermMonths: [...new Set(leases.flatMap((l) => l.leaseTermMonths))].sort(
            (a, b) => a - b
          ),
          leases,
          designator: wholeProperty ? "Whole" : null,
          number: null,
          leaseAvailability: dates.some((d) => !d) ? null : dates.sort()[0] ?? null,
        };
      });

      // The property and unit both already exist — only the caller's own lease
      // is created. The sublease guard is enforced by the database.
      const postLease = (lease) =>
        fetch("/api/leases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unitId: unitSelection.unitId,
            rent: lease.rent,
            rentIsPerPerson: lease.rentIsPerPerson,
            leaseTermMonths: lease.leaseTermMonths,
            availableFrom: lease.availableFrom,
            sublease: String(form.lease_type).toLowerCase() === "sublease",
            available: units[0]?.available !== false,
            description: form.description,
            furnished: form.furnished,
            contactEmail: form.contact_email || null,
            contactPhone: form.contact_phone || null,
            contactName: form.contact_name || null,
          }),
        });
      /*
       * Attaching to an existing unit: the unit is already there, so each lease
       * is its own offering on it. Stops at the first refusal so the landlord
       * sees why, and the photos below attach to the offering that went in.
       */
      const attachLeases = async () => {
        let last = null;
        for (const lease of unitPayload[0]?.leases ?? []) {
          last = await postLease(lease);
          if (!last.ok) break;
        }
        return last;
      };
      const res = attachingToExistingUnit
        ? await attachLeases()
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
          // On an import tab, the listing the address check matched (the
          // landlord's own when they have one), not merely the oldest row.
          ...(batchExisting
            ? { attachToListingId: batchExisting.id }
            : existingProperty
            ? { attachToListingId: existingProperty.id }
            : {}),
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
        } else if (data.code === "address_taken" && batch?.onExisting) {
          // Not a second copy: this tab now updates the listing already here.
          batch.onExisting(batch.tabKey, data.existing);
          const message =
            "This address is already on Proximity, so this tab now updates that listing. Check the Units step, then publish again.";
          setError(message);
          setStepId("units");
          return { ok: false, error: message };
        } else {
          setError(data.error || "Something went wrong.");
        }
        return { ok: false, error: data.error || "Something went wrong." };
      }

      // Upload staged images via presigned URLs (browser -> R2 directly).
      // A photo failure never un-saves the listing, so in queue mode it must
      // not hold the remaining properties hostage: toast it and keep going.
      let uploadError = null;
      /*
       * A property already on Proximity keeps the photos it has: the building's
       * gallery belongs to its owner, and /api/upload would refuse anyone else.
       * Photos of this landlord's own units still go on their units below.
       */
      if (stagedFiles.length > 0 && !batchExisting) {
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
      /*
       * Unit photos, already uploaded, filed against the units that were just
       * created. /api/addListing returns their ids in the order the units were
       * sent, which is the order of `units`.
       */
      const newUnitIds = data.listing?.unitIds ?? [];
      const publishedId = data.listing?.id ?? data.lease?.listingId ?? null;
      for (const [i, u] of createUnits.entries()) {
        const urls = u.photos ?? [];
        const unitId = attachingToExistingUnit ? unitSelection.unitId : newUnitIds[i];
        if (!urls.length || !unitId || !publishedId) continue;
        const res = await fetch("/api/upload", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: publishedId, unitId, urls }),
        }).catch(() => null);
        if (!res?.ok)
          uploadError = `Listing saved, but the photos for ${
            u.title || `unit ${i + 1}`
          } could not be attached. You can add them from your dashboard.`;
      }

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
      return {
        ok: true,
        listingId: publishedId,
        unitPayload,
        diff: Object.keys(diff).length ? diff : null,
      };
    } catch {
      setError("Network error. Please try again.");
      return { ok: false, error: "Network error. Please try again." };
    } finally {
      setSubmitting(false);
    }
  };

  const publish = async () => {
    const result = await submitListing();
    if (!result.ok) return;
    // Multi-property import: load the next queued property instead of leaving.
    if (importQueue.length > 0) {
      await advanceImportQueue(result.unitPayload, result.diff);
      return;
    }
    await onSuccess(result.unitPayload, result.diff);
  };

  /*
   * What the workspace needs from this tab, refreshed every render so it
   * always reads current state: whether it can publish, a way to show why
   * not, publishing itself, and a one-line summary for the sidebar.
   */
  const batchApi = useRef({});
  batchApi.current = {
    firstProblem,
    showProblem,
    submit: submitListing,
    summary: {
      title: form.title || form.address || null,
      units: units.length,
      leases: units.reduce((n, u) => n + (u.leases?.length ?? 0), 0),
    },
  };
  useEffect(() => {
    batch?.onRegister?.(batch.tabKey, batchApi);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The sidebar's line for this tab ("4 units · 9 leases"), kept current.
  const summaryKey = JSON.stringify(batchApi.current.summary);
  useEffect(() => {
    batch?.onSummary?.(batch.tabKey, JSON.parse(summaryKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryKey]);

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
    addLease,
    removeLease,
    updateLease,
    applyTermsToAll,
    restoreUnits,
    uploadUnitPhotos,
    unitPhotoUploading,
    removeUnitPhoto,
    batchMode: !!batch,
    batchExisting,
    ownExisting,
    setUnitRetire,
    setLeaseRetire,
    revertLease,
    revertUnitField,
    onImportMany,
    existingEdits,
    editExistingLease,
    resetExistingLease,
    existingNewLeases,
    addExistingUnitLease,
    updateExistingUnitLease,
    removeExistingUnitLease,
    uploadFloorPlan,
    floorPlanUploading,
    floorPlanError,
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
    <div className={batch ? "w-full" : "w-full max-w-2xl mx-auto px-4 py-8"}>
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

      {/* A tab's draft is kept and discarded by the workspace, not here. */}
      <div className={`mt-3 flex items-center justify-center gap-4 text-center${batch ? " hidden" : ""}`}>
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
