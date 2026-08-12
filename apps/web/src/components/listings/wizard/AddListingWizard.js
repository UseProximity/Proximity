"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { emptyUnit } from "@/components/listings/listingFormOptions";
import StepStart from "@/components/listings/wizard/StepStart";
import StepAddress from "@/components/listings/wizard/StepAddress";
import StepBasics from "@/components/listings/wizard/StepBasics";
import StepUnits from "@/components/listings/wizard/StepUnits";
import StepPerks from "@/components/listings/wizard/StepPerks";
import StepPhotos from "@/components/listings/wizard/StepPhotos";
import StepDescription from "@/components/listings/wizard/StepDescription";
import StepReview from "@/components/listings/wizard/StepReview";

/*
 * Step-by-step Add Listing flow. One themed question set per screen, a labeled
 * progress bar that never lies, autosave to localStorage, and a review screen
 * before publishing. A website import fills what it can, then the wizard jumps
 * straight to the gaps. Editing an existing listing keeps the classic full
 * form (ListingFormPanel) — random access beats steps once data exists.
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
  move_in_date: "",
  contact_email: user?.email ?? "",
  contact_phone: user?.phone ?? "",
  contact_name: user?.name ?? "",
  amenities: [],
  utilities_included: [],
  lease_availability: [],
});

export default function AddListingWizard({ user, onClose, onSuccess }) {
  const [stepId, setStepId] = useState("start"); // "start" | STEPS ids
  const [form, setForm] = useState(() => blankForm(user));
  const [units, setUnits] = useState([emptyUnit()]);
  const [customAmenities, setCustomAmenities] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [visited, setVisited] = useState(() => new Set());
  // "now" | "date" — the required one-tap availability ask on the basics step.
  const [availabilityMode, setAvailabilityMode] = useState("now");

  // Photos staged in the browser; uploaded to R2 after the listing is created.
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedPreviews, setStagedPreviews] = useState([]);

  // Street View default cover (fetched when an address suggestion is picked).
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [streetView, setStreetView] = useState({ available: false, url: null });
  const [streetViewDeleted, setStreetViewDeleted] = useState(false);
  const [streetViewLoading, setStreetViewLoading] = useState(false);

  // Website-import state (see ListingDraftImport): amber marks, batch queue.
  const [importInfo, setImportInfo] = useState(null);
  const [importedFields, setImportedFields] = useState(() => new Set());
  const [importQueue, setImportQueue] = useState([]);
  const importPastedUrl = useRef(null);
  const prefetchRef = useRef(null);
  const importBatch = useRef({ done: 0, total: 0 });
  const [resumed, setResumed] = useState(false);

  // ------------------------------------------------------------------ autosave
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
      if (saved.form?.move_in_date) setAvailabilityMode("date");
      setUnits(saved.units?.length ? saved.units : [emptyUnit()]);
      setCustomAmenities(saved.customAmenities ?? []);
      setCoords(saved.coords ?? { lat: null, lng: null });
      if (saved.stepId && saved.stepId !== "start") setStepId(saved.stepId);
      setVisited(new Set(saved.visited ?? []));
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
          savedAt: Date.now(),
        })
      );
    } catch {
      /* storage full/blocked — autosave is best-effort */
    }
  }, [form, units, customAmenities, coords, stepId, visited, user?.id]);

  const clearAutosave = () => {
    try {
      localStorage.removeItem(AUTOSAVE_KEY(user?.id));
    } catch {
      /* ignore */
    }
  };

  const startFresh = () => {
    clearAutosave();
    setForm(blankForm(user));
    setUnits([emptyUnit()]);
    setCustomAmenities([]);
    stagedPreviews.forEach((u) => URL.revokeObjectURL(u));
    setStagedFiles([]);
    setStagedPreviews([]);
    setCoords({ lat: null, lng: null });
    setStreetView({ available: false, url: null });
    setStreetViewDeleted(false);
    setImportedFields(new Set());
    setImportInfo(null);
    setImportQueue([]);
    prefetchRef.current = null;
    importBatch.current = { done: 0, total: 0 };
    setAvailabilityMode("now");
    setResumed(false);
    setError(null);
    setVisited(new Set());
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
  const compressImage = (file) =>
    new Promise((resolve) => {
      if (file.size < 1 * 1024 * 1024) {
        resolve(file);
        return;
      }
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            resolve(
              new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
                type: "image/jpeg",
              })
            );
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });

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
  const importPhotos = async (urls) => {
    const files = new Array(urls.length);
    // Four at a time: firing a dozen full-size downloads at once overwhelms
    // slow CDNs/connections and times out the proxy; a small pool finishes
    // sooner AND drops fewer photos.
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= urls.length) return;
        try {
          const res = await fetch(
            `/api/landlord/listing-draft/image?url=${encodeURIComponent(urls[idx])}`
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
    await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
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
    for (const { index, url } of items) {
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
        setUnits((us) =>
          us.map((un, i) => (i === index ? { ...un, floorPlanImageUrl: data.url } : un))
        );
      } catch {
        importPhotos([url]);
      }
    }
  };

  const requestQueuedDraft = (target) =>
    fetch("/api/landlord/listing-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: importPastedUrl.current, targetProperty: target }),
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.listing) throw new Error(data.error || "extract failed");
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
        case "basics":
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
    // Earliest dated unit availability prefills the move-in date ("now"
    // means available immediately, which an empty date already implies).
    const availDates = (listing.units ?? [])
      .map((u) => u.availableFrom)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ""))
      .sort();
    if (availDates[0]) {
      marked.add("move_in_date");
      setAvailabilityMode("date");
    }

    setForm((f) => {
      const next = { ...f };
      for (const [key, val] of Object.entries(importable)) {
        if (val != null && val !== "") next[key] = val;
      }
      if (listing.furnished != null) next.furnished = listing.furnished;
      if (availDates[0] && !f.move_in_date) next.move_in_date = availDates[0];
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
      nextUnits = listing.units.slice(0, 12).map((u, i) => {
        for (const fld of ["bedrooms", "bathrooms", "rent", "area", "title"]) {
          if (u[fld] != null && u[fld] !== "") marked.add(`u${i}:${fld}`);
        }
        if (u.floorPlanImageUrl) floorPlanImports.push({ index: i, url: u.floorPlanImageUrl });
        return {
          bedrooms: u.bedrooms ?? "",
          bathrooms: u.bathrooms ?? "",
          rent: u.rent ?? "",
          area: u.area ?? "",
          available: true,
          title: u.title ?? "",
          floorPlanImageUrl: "",
          leaseTermMonths: [],
        };
      });
    }
    setUnits(nextUnits);
    if (floorPlanImports.length) importFloorPlans(floorPlanImports);
    setImportedFields(marked);

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
    if (photoUrls.length) importPhotos(photoUrls);

    // Jump to the first gap. Steps the import satisfied count as visited so
    // the progress bar honestly shows them done (endowed progress you earned).
    const importDone = new Set(["basics", "perks", "photos"]);
    if (listing.address) importDone.add("address");
    if (listing.description) importDone.add("description");
    setVisited((prev) => new Set([...prev, ...importDone]));
    const unitsOk =
      nextUnits.length > 0 &&
      nextUnits.every((u) => u.bedrooms !== "" && u.bathrooms !== "") &&
      nextUnits.every((u) => (u.leaseTermMonths ?? []).length > 0);
    const firstGap = !listing.address
      ? "address"
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

  const validateStep = (id) => {
    if (id === "address" && !form.address.trim()) return "Enter the property address to continue.";
    if (id === "basics" && availabilityMode === "date" && !form.move_in_date)
      return "Pick the date it becomes available, or tap Available now.";
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
    }
    if (id === "description" && !form.description.trim())
      return "A short description is required.";
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
      const unitPayload = units.map((u) => ({
        bedrooms: Number(u.bedrooms),
        bathrooms: Number(u.bathrooms),
        rent: u.rent !== "" ? Number(u.rent) : null,
        area: u.area !== "" ? Number(u.area) : null,
        available: u.available !== false,
        title: (u.title ?? "").trim() || null,
        floorPlanImageUrl: u.floorPlanImageUrl || null,
        leaseTermMonths: Array.isArray(u.leaseTermMonths)
          ? u.leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
          : [],
      }));

      const res = await fetch("/api/addListing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          unitTypes: unitPayload,
          customAmenities,
          // /api/addListing reads camelCase moveInDate; the snake_case
          // move_in_date in ...form was silently dropped (long-standing
          // create-path bug — edit always saved it).
          moveInDate: form.move_in_date || null,
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
        setError(data.error || "Something went wrong.");
        return;
      }

      // Upload staged images via presigned URLs (browser -> R2 directly).
      // A photo failure never un-saves the listing, so in queue mode it must
      // not hold the remaining properties hostage: toast it and keep going.
      let uploadError = null;
      if (stagedFiles.length > 0) {
        const listingId = data.listing?.id;
        if (listingId) {
          const presignRes = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              listingId,
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
        }
      }
      if (uploadError && importQueue.length === 0) {
        setError(uploadError);
        return;
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
    // fresh form for the next property
    setForm(blankForm(user));
    setUnits([emptyUnit()]);
    setCustomAmenities([]);
    stagedPreviews.forEach((u) => URL.revokeObjectURL(u));
    setStagedFiles([]);
    setStagedPreviews([]);
    setStreetView({ available: false, url: null });
    setStreetViewDeleted(false);
    setCoords({ lat: null, lng: null });
    setImportedFields(new Set());
    setVisited(new Set());
    setAvailabilityMode("now");
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
      } catch {
        toast.error(`Couldn't import ${target.name}, skipping it.`);
      }
    }
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
    customAmenities,
    addCustomAmenity,
    removeCustomAmenity,
    stagedFiles,
    stagedPreviews,
    handleImageFiles,
    removeStagedImage,
    coords,
    setCoords,
    availabilityMode,
    setAvailabilityMode,
    streetView,
    streetViewDeleted,
    setStreetViewDeleted,
    streetViewLoading,
    fetchStreetViewPreview,
    importedFields,
    clearImported,
    importInfo,
    importQueue,
    applyDraft,
    stepComplete,
    goTo,
    startFresh,
    error,
    submitting,
    publish,
  };

  const renderStep = () => {
    switch (stepId) {
      case "start":
        return <StepStart w={w} onBegin={() => goTo("address")} />;
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
