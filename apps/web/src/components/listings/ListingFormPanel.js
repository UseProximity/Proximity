"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, Plus, RefreshCw, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import toast from "react-hot-toast";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";
import ListingDraftImport from "@/components/listings/ListingDraftImport";

// The four PMSs the sync integration supports today. Shown as a shortcut on
// the ADD flow only: landlords on one of these should connect it instead of
// typing listings in by hand.
const PMS_SYNC_OPTIONS = [
  { label: "Buildium", logo: "/pms-logos/buildium.png" },
  { label: "AppFolio", logo: "/pms-logos/appfolio.png" },
  { label: "DoorLoop", logo: "/pms-logos/doorloop.png" },
  { label: "Rentec Direct", logo: "/pms-logos/rentecdirect.png" },
];

// Add / Edit Listing Modal -------------------------------------------------------
// Option lists shared with the add-listing wizard (see listingFormOptions.js).
import { clampCount } from "@/utils/unitCounts";
import {
  AMENITY_OPTIONS,
  AMENITY_LABELS,
  UTILITY_OPTIONS,
  UTILITY_LABELS,
  HOME_TYPES,
  LEASE_TYPES,
  LEASE_TERM_PRESETS,
  emptyUnit,
} from "@/components/listings/listingFormOptions";

// Shared add/edit listing form for landlords. Renders as a modal by default
// (used for editing inside the dashboard) or as a full-page form when `asPage`
// is true (used by the standalone /add-listing page).
export default function ListingFormPanel({
  listing,
  onClose,
  onSuccess,
  user,
  asPage = false,
}) {
  const isEdit = !!listing;
  const [form, setForm] = useState({
    address: listing?.address ?? "",
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    home_type: (
      listing?.home_type ??
      listing?.homeType ??
      "apartment"
    ).toLowerCase(),
    lease_type: listing?.lease_type ?? listing?.leaseType ?? "standard",
    furnished: listing?.furnished ?? false,
    sublease_friendly:
      listing?.sublease_friendly ?? listing?.subleaseFriendly ?? false,
    twenty_one_plus:
      listing?.twenty_one_plus ?? listing?.twentyOnePlus ?? false,
    move_in_date:
      listing?.move_in_date ??
      (listing?.moveInDate ? listing.moveInDate.slice(0, 10) : ""),
    // Auto-fill contact info from the landlord's profile for new listings
    contact_email:
      listing?.contact_email ?? listing?.contactEmail ?? user?.email ?? "",
    contact_phone:
      listing?.contact_phone ?? listing?.contactPhone ?? user?.phone ?? "",
    contact_name:
      listing?.contact_name ?? listing?.contactName ?? user?.name ?? "",
    amenities: listing?.amenities ?? [],
    utilities_included:
      listing?.utilities_included ?? listing?.utilitiesIncluded ?? [],
    lease_availability: (() => {
      const raw =
        listing?.lease_availability ?? listing?.leaseAvailability ?? [];
      const canon = ["Semester", "10-Month", "12-Month", "Summer"];
      const byLower = new Map(canon.map((v) => [v.toLowerCase(), v]));
      return Array.from(
        new Set(
          raw.map((v) => byLower.get(String(v).toLowerCase())).filter(Boolean)
        )
      );
    })(),
  });
  const rawUnits = listing?.listing_units ?? listing?.unitTypes ?? [];
  const [units, setUnits] = useState(
    rawUnits.length
      ? rawUnits.map((u) => ({
          bedrooms: u.bedrooms ?? "",
          bathrooms: u.bathrooms ?? "",
          rent: u.rent ?? "",
          area: u.area ?? "",
          available: u.available ?? true,
          title: u.title ?? "",
          floorPlanImageUrl: u.floorPlanImageUrl ?? u.floor_plan_image_url ?? "",
          leaseTermMonths: Array.isArray(u.leaseTermMonths)
            ? u.leaseTermMonths.map(Number)
            : Array.isArray(u.lease_term_months)
            ? u.lease_term_months.map(Number)
            : [],
        }))
      : [emptyUnit()]
  );
  const [customAmenities, setCustomAmenities] = useState(
    Array.isArray(listing?.customAmenities) ? listing.customAmenities : []
  );
  const [customAmenityInput, setCustomAmenityInput] = useState("");
  // Per-unit floor-plan upload progress (keyed by unit index)
  const [floorPlanUploading, setFloorPlanUploading] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  /*
   * A rejection the landlord can only fix at one input — right now just a
   * taken property name. Held apart from `error` so it can be shown ON the
   * field instead of in the banner at the bottom of a long form, which is
   * scrolled well out of view by the time a name is being edited.
   */
  const [fieldError, setFieldError] = useState(null);

  // Website-import draft state (add flow only). importedFields holds the names
  // of fields prefilled from the landlord's site ("address", "u0:rent", ...);
  // each clears when the landlord touches that field, dropping its amber tint.
  const [importInfo, setImportInfo] = useState(null);
  const [importedFields, setImportedFields] = useState(() => new Set());
  // Multi-property conveyor belt: remaining picked properties (importQueue),
  // the originally pasted URL the API needs for each, and a one-ahead prefetch
  // so the next property is usually ready the moment this listing is created.
  const [importQueue, setImportQueue] = useState([]);
  const importPastedUrl = useRef(null);
  const prefetchRef = useRef(null); // { name, promise }

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
  const clearImported = (key) =>
    setImportedFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  const importedCls = (key) =>
    importedFields.has(key) ? " ring-1 ring-amber-400 bg-amber-50" : "";

  // Image upload
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedPreviews, setStagedPreviews] = useState([]);
  const [existingImages, setExistingImages] = useState(listing?.images ?? []);
  const [savingImageOrder, setSavingImageOrder] = useState(false);

  // Auto Street View default photo (new listings only). Coordinates come from the selected
  // address suggestion; if kept, /api/addListing stores it server-side as the cover photo.
  const [coords, setCoords] = useState({ lat: null, lng: null });
  const [streetView, setStreetView] = useState({ available: false, url: null });
  const [streetViewDeleted, setStreetViewDeleted] = useState(false);
  const [streetViewLoading, setStreetViewLoading] = useState(false);
  const showStreetView = !isEdit && streetView.available && !streetViewDeleted;

  const fetchStreetViewPreview = async (address, lat, lng) => {
    setStreetViewDeleted(false);
    setStreetView({ available: false, url: null });
    setStreetViewLoading(true);
    try {
      const params = new URLSearchParams({
        address,
        lat: String(lat),
        lng: String(lng),
      });
      const res = await fetch(`/api/streetview/preview?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.available && data?.url)
        setStreetView({ available: true, url: data.url });
    } catch (err) {
      console.error("Street View preview error:", err);
    } finally {
      setStreetViewLoading(false);
    }
  };

  const handleReorderExistingImages = async (nextUrls) => {
    const prev = existingImages;
    setExistingImages(nextUrls);
    if (!isEdit) return;
    setSavingImageOrder(true);
    try {
      const listingId = listing._id || listing.id;
      const res = await fetch(`/api/landlord/listings/${listingId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: nextUrls }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save image order.");
        setExistingImages(prev);
      }
    } catch {
      setError("Failed to save image order.");
      setExistingImages(prev);
    } finally {
      setSavingImageOrder(false);
    }
  };

  // Address autocomplete
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const addressRef = useRef(null);
  const addressDebounceRef = useRef(null);

  // Close address dropdown on outside click
  useEffect(() => {
    function onOutsideClick(e) {
      if (addressRef.current && !addressRef.current.contains(e.target)) {
        setAddressDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    document.addEventListener("touchstart", onOutsideClick);
    return () => {
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("touchstart", onOutsideClick);
    };
  }, []);

  const fetchAddressSuggestions = useCallback((query) => {
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (!query || query.trim().length < 3) {
      setAddressSuggestions([]);
      setAddressDropdownOpen(false);
      return;
    }
    addressDebounceRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) return;
      setAddressLoading(true);
      try {
        const encoded = encodeURIComponent(query.trim());
        // proximity biases ranking toward the WashU area so street-only
        // queries ("718 Limit") surface the St. Louis match first.
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=5&country=US&types=address,place&proximity=-90.3123,38.6488`
        );
        const data = await res.json();
        const suggestions = (data.features ?? []).map((f) => ({
          label: f.place_name,
          center: f.center,
        }));
        setAddressSuggestions(suggestions);
        setAddressDropdownOpen(suggestions.length > 0);
      } catch {
        setAddressSuggestions([]);
      } finally {
        setAddressLoading(false);
      }
    }, 300);
  }, []);

  const handleAddressInput = (e) => {
    const value = e.target.value;
    clearImported("address");
    setForm((f) => ({ ...f, address: value }));
    fetchAddressSuggestions(value);
  };

  const selectAddressSuggestion = (suggestion) => {
    const autoTitle = suggestion.label.split(",")[0].trim();
    setForm((f) => ({
      ...f,
      address: suggestion.label,
      title:
        !f.title || f.title === (f.address || "").split(",")[0].trim()
          ? autoTitle
          : f.title,
    }));
    setAddressSuggestions([]);
    setAddressDropdownOpen(false);

    // Mapbox center is [lng, lat]. Capture it and fetch a Street View default (new listings).
    const [lng, lat] = suggestion.center ?? [];
    if (lat != null && lng != null) {
      setCoords({ lat, lng });
      if (!isEdit) fetchStreetViewPreview(suggestion.label, lat, lng);
    }
  };

  const compressImage = (file) =>
    new Promise((resolve) => {
      // Skip files already under 1 MB
      if (file.size < 1 * 1024 * 1024) {
        resolve(file);
        return;
      }
      // window.Image, not the next/image import this file shadows the global with.
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

  const removeExistingImage = (url) =>
    setExistingImages((prev) => prev.filter((u) => u !== url));

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    clearImported(name);
    // Editing the field the server complained about retires the complaint; the
    // next save re-checks it anyway.
    setFieldError((fe) => (fe?.field === name ? null : fe));
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
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

  const uploadFloorPlan = async (i, file) => {
    if (!file) return;
    setFloorPlanUploading((p) => ({ ...p, [i]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/floor-plan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      updateUnit(i, "floorPlanImageUrl", data.url);
    } catch (err) {
      setError(err.message || "Floor plan upload failed.");
    } finally {
      setFloorPlanUploading((p) => ({ ...p, [i]: false }));
    }
  };

  const addCustomAmenity = () => {
    const v = customAmenityInput.trim();
    if (!v) return;
    setCustomAmenities((prev) =>
      prev.some((a) => a.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]
    );
    setCustomAmenityInput("");
  };
  const removeCustomAmenity = (val) =>
    setCustomAmenities((prev) => prev.filter((a) => a !== val));

  // Toggle / add / remove a lease-term (months) on a unit's multi-select.
  const toggleUnitTerm = (i, months) => {
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
  };
  const removeUnitTerm = (i, months) => toggleUnitTerm(i, months);
  const [customTermInput, setCustomTermInput] = useState({});
  const addCustomUnitTerm = (i) => {
    const n = Number(customTermInput[i]);
    if (!Number.isFinite(n) || n <= 0) return;
    setUnits((u) =>
      u.map((unit, idx) => {
        if (idx !== i) return unit;
        const cur = Array.isArray(unit.leaseTermMonths) ? unit.leaseTermMonths : [];
        if (cur.includes(n)) return unit;
        return { ...unit, leaseTermMonths: [...cur, n].sort((a, b) => a - b) };
      })
    );
    setCustomTermInput((prev) => ({ ...prev, [i]: "" }));
  };

  // Pull each photo Claude picked through the SSRF-guarded proxy and stage it
  // like a normal upload, so imported photos ride the existing browser-to-R2
  // pipeline and each one can be removed before submitting.
  const importPhotos = async (urls) => {
    const files = new Array(urls.length);
    await Promise.allSettled(
      urls.map(async (u, idx) => {
        const res = await fetch(
          `/api/landlord/listing-draft/image?url=${encodeURIComponent(u)}`
        );
        if (!res.ok) return;
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) return;
        if (blob.size < 15000) return; // tiny files are icons/thumbnails, not photos
        const ext = (blob.type.split("/")[1] || "jpg").split("+")[0];
        files[idx] = new File([blob], `imported-${idx + 1}.${ext}`, {
          type: blob.type,
        });
      })
    );
    const ok = files.filter(Boolean);
    if (ok.length) await handleImageFiles(ok);
    setImportInfo((prev) =>
      prev ? { ...prev, photosLoading: false, photoCount: ok.length } : prev
    );
  };

  // Tracks progress through a multi-property batch for the summary banner.
  const importBatch = useRef({ done: 0, total: 0 });

  // Apply an extracted website draft to the form. Only non-empty values land;
  // everything applied gets marked "imported" until the landlord touches it.
  // meta: { sourceUrl, pastedUrl, queue, isQueueAdvance }.
  const applyDraft = (listing, meta) => {
    const { sourceUrl, pastedUrl, queue = [], isQueueAdvance = false } = meta ?? {};
    const marked = new Set();
    setForm((f) => {
      const next = { ...f };
      const setIf = (key, val) => {
        if (val != null && val !== "") {
          next[key] = val;
          marked.add(key);
        }
      };
      setIf("address", listing.address);
      setIf("title", listing.title);
      setIf("description", listing.description);
      setIf("home_type", listing.home_type);
      setIf("contact_name", listing.contact_name);
      setIf("contact_email", listing.contact_email);
      setIf("contact_phone", listing.contact_phone);
      if (listing.furnished != null) next.furnished = listing.furnished;
      const known = (vals, options) =>
        (vals ?? []).filter((v) => options.includes(v));
      const knownAmenities = known(listing.amenities, AMENITY_OPTIONS);
      if (knownAmenities.length) {
        next.amenities = Array.from(new Set([...f.amenities, ...knownAmenities]));
      }
      const knownUtilities = known(listing.utilities_included, UTILITY_OPTIONS);
      if (knownUtilities.length) {
        next.utilities_included = Array.from(
          new Set([...f.utilities_included, ...knownUtilities])
        );
      }
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
    if (Array.isArray(listing.units) && listing.units.length) {
      setUnits(
        listing.units.slice(0, 12).map((u, i) => {
          for (const fld of ["bedrooms", "bathrooms", "rent", "area", "title"]) {
            if (u[fld] != null && u[fld] !== "") marked.add(`u${i}:${fld}`);
          }
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
        })
      );
    }
    setImportedFields(marked);

    // Open the Mapbox dropdown on the imported address so one tap upgrades a
    // street-only address ("718 Limit") to the verified full address that
    // powers geocoding, maps, and walk times.
    if (marked.has("address") && listing.address) {
      fetchAddressSuggestions(listing.address);
    }

    importPastedUrl.current = pastedUrl ?? importPastedUrl.current;
    setImportQueue(queue);
    prefetchNext(queue);
    if (isQueueAdvance) importBatch.current.done += 1;
    else importBatch.current = { done: 1, total: queue.length + 1 };

    let host = "your website";
    try {
      host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      /* keep fallback label */
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
  };

  // Blank the form fields (used by "start over" and between queued properties).
  const clearFormFields = () => {
    setForm({
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
    setUnits([emptyUnit()]);
    setCustomAmenities([]);
    stagedPreviews.forEach((url) => URL.revokeObjectURL(url));
    setStagedFiles([]);
    setStagedPreviews([]);
    setImportedFields(new Set());
  };

  // "Start over": back to the blank form the landlord would have seen without
  // the import, dropping any queued properties too.
  const resetImport = () => {
    clearFormFields();
    setImportInfo(null);
    setImportQueue([]);
    prefetchRef.current = null;
    importBatch.current = { done: 0, total: 0 };
  };

  // After a queued-import listing is created: blank the form and load the next
  // property (usually instant thanks to the prefetch). onSuccess — which
  // normally navigates away — only fires once the whole batch is done.
  const advanceImportQueue = async (unitPayload, diff) => {
    let queue = importQueue;
    toast.success("Listing created!");
    clearFormFields();
    while (queue.length) {
      const target = queue[0];
      queue = queue.slice(1);
      setImportQueue(queue);
      setImportInfo({ loadingNext: target.name });
      try {
        const pre = prefetchRef.current;
        prefetchRef.current = null;
        const data =
          pre && pre.name === target.name ? await pre.promise : null;
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setFieldError(null);
    if (!form.address.trim()) {
      setError("Address is required.");
      return;
    }
    if (!form.description.trim()) {
      setError("Description is required.");
      return;
    }
    if (units.length === 0) {
      setError("At least one unit is required.");
      return;
    }
    if (units.some((u) => u.bedrooms === "" || u.bathrooms === "")) {
      setError("Each unit needs bedrooms and bathrooms.");
      return;
    }
    // An available unit must offer at least one lease term, otherwise it would
    // show up with no availability (or borrow another unit's).
    if (
      units.some(
        (u) =>
          u.available !== false &&
          !(Array.isArray(u.leaseTermMonths) && u.leaseTermMonths.length > 0)
      )
    ) {
      setError(
        "Each available unit needs at least one lease term (or mark it unavailable)."
      );
      return;
    }

    setSubmitting(true);
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

      let res;
      if (isEdit) {
        res = await fetch(
          `/api/landlord/listings/${listing._id || listing.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: form.address,
              title: form.title,
              description: form.description,
              home_type: form.home_type,
              lease_type: form.lease_type,
              furnished: form.furnished,
              sublease_friendly: form.sublease_friendly,
              twenty_one_plus: form.twenty_one_plus,
              move_in_date: form.move_in_date || null,
              contact_email: form.contact_email || null,
              contact_phone: form.contact_phone || null,
              contact_name: form.contact_name || null,
              amenities: form.amenities,
              custom_amenities: customAmenities,
              utilities_included: form.utilities_included,
              // lease_availability is derived server-side from each unit's lease terms
              // persist any existing-image removals
              images: existingImages,
              units: unitPayload,
            }),
          }
        );
      } else {
        res = await fetch("/api/addListing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            unitTypes: unitPayload,
            customAmenities,
            // addListing expects camelCase for contact fields
            contactEmail: form.contact_email || null,
            contactPhone: form.contact_phone || null,
            contactName: form.contact_name || null,
            // Pass selected coordinates so the server skips re-geocoding and the stored
            // Street View shot matches the preview orientation.
            ...(coords.lat != null && coords.lng != null
              ? { longitude: coords.lng, latitude: coords.lat }
              : {}),
            // Default Street View cover when the landlord uploaded no photos of their own
            // and hasn't dismissed the preview. Server re-validates imagery and no-ops if
            // none, so this doesn't depend on the browser preview having resolved. (This
            // branch is create-only — the edit path above never attaches Street View.)
            attachStreetView: !streetViewDeleted && stagedFiles.length === 0,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        /*
         * `field` marks a rejection that belongs to one input (a taken property
         * name). It goes to that input rather than the banner so the landlord is
         * looking at the thing they have to change.
         */
        if (data.field) {
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

      // Upload staged images via presigned URLs so files go directly from the
      // browser to R2, bypassing Vercel's 4.5 MB serverless body limit.
      if (stagedFiles.length > 0) {
        const listingId = isEdit ? listing._id || listing.id : data.listing?.id;
        if (listingId) {
          // Step 1: get presigned PUT URLs for each file
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
            console.error(
              "[upload] failed to get presigned URLs:",
              presignData.error
            );
            setError(
              `Listing saved, but images failed to upload: ${
                presignData.error || `server error ${presignRes.status}`
              }`
            );
            setSubmitting(false);
            return;
          }
          const { presigned } = await presignRes.json();

          // Step 2: upload each file directly to R2
          const uploadResults = await Promise.allSettled(
            stagedFiles.map((file, i) =>
              fetch(presigned[i].uploadUrl, {
                method: "PUT",
                body: file,
                headers: { "Content-Type": file.type },
              })
            )
          );
          const failedUploads = uploadResults.filter(
            (r) => r.status === "rejected" || !r.value?.ok
          );
          if (failedUploads.length > 0) {
            console.error(
              "[upload] some files failed to upload to R2:",
              failedUploads
            );
            setError(
              `Listing saved, but ${failedUploads.length} image(s) failed to upload. Please try re-uploading them.`
            );
            setSubmitting(false);
            return;
          }

          // Step 3: record the confirmed public URLs on the listing
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
            console.error(
              "[upload] failed to confirm image URLs:",
              confirmData.error
            );
            setError(
              `Listing saved, but images were uploaded and could not be saved: ${
                confirmData.error || `server error ${confirmRes.status}`
              }`
            );
            setSubmitting(false);
            return;
          }
        }
      }

      // Check if the contact info differs from the landlord's profile
      const diff = {};
      const trim = (v) => (v ?? "").trim();
      if (
        trim(form.contact_name) &&
        trim(form.contact_name) !== trim(user?.name)
      ) {
        diff.name = trim(form.contact_name);
      }
      if (
        trim(form.contact_email) &&
        trim(form.contact_email) !== trim(user?.email)
      ) {
        diff.email = trim(form.contact_email);
      }
      if (
        trim(form.contact_phone) &&
        trim(form.contact_phone) !== trim(user?.phone)
      ) {
        diff.phone = trim(form.contact_phone);
      }

      // Multi-property import: instead of navigating away, load the next
      // queued property into a fresh form. onSuccess fires after the last one.
      if (!isEdit && importQueue.length > 0) {
        await advanceImportQueue(
          unitPayload,
          Object.keys(diff).length > 0 ? diff : null
        );
        return;
      }

      await onSuccess(unitPayload, Object.keys(diff).length > 0 ? diff : null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={
        asPage
          ? "w-full max-w-2xl mx-auto px-4 py-8"
          : "fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4"
      }
    >
      <div
        className={
          asPage
            ? "bg-white rounded-xl shadow-sm border border-gray-200 w-full"
            : "bg-white rounded-xl shadow-2xl w-full max-w-2xl"
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            {isEdit ? "Edit Listing" : "Add New Listing"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg
              className="h-5 w-5 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* PMS shortcut: landlords on a supported system should sync, not type.
            Add flow only; editing an existing listing stays manual. */}
        {!isEdit && (
          <div className="mx-6 mt-5 rounded-xl border border-red-100 bg-gradient-to-r from-red-50/80 to-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex shrink-0 -space-x-2 pt-0.5">
                  {PMS_SYNC_OPTIONS.map((p) => (
                    <Image
                      key={p.label}
                      src={p.logo}
                      alt={p.label}
                      title={p.label}
                      width={56}
                      height={56}
                      className="h-8 w-8 rounded-full border border-gray-200 bg-white object-contain p-1 shadow-sm"
                    />
                  ))}
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Use Buildium, AppFolio, DoorLoop, or Rentec Direct?
                    <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 align-[2px] text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                      Beta
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
                    Skip the typing. Connect your system once and your listings create
                    themselves, stay priced right, and come off the moment they lease.
                    Auto sync is still in beta while we test it with live accounts.
                  </p>
                </div>
              </div>
              <Link
                href="/dashboard/landlord?tab=integrations"
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2"
              >
                <RefreshCw className="h-4 w-4" /> Set up auto sync
              </Link>
            </div>
          </div>
        )}

        {/* Website import: paste a property site, get the form prefilled as a
            draft. Add flow only; nothing here touches the edit path. */}
        {!isEdit &&
          (importInfo?.loadingNext ? (
            <div className="mx-6 mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
              Loading the next property: {importInfo.loadingNext}…
            </div>
          ) : importInfo ? (
            <div className="mx-6 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">
                Imported from {importInfo.host}
                {importInfo.batchTotal > 1
                  ? ` (property ${importInfo.batchDone} of ${importInfo.batchTotal})`
                  : ""}
                . Please double-check everything.
              </p>
              {importInfo.addressNeedsConfirm && (
                <p className="mt-1 text-xs font-medium text-amber-900">
                  First: confirm the address by tapping the right suggestion in
                  the dropdown under the Address box, that&apos;s what puts your
                  listing on the map.
                </p>
              )}
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Highlighted fields came from your site; they turn white once you
                edit them. Rent and lease terms usually still need your input,
                and every available unit needs at least one lease term.
              </p>
              {importInfo.photosLoading ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-800">
                  <span className="h-3 w-3 animate-spin rounded-full border border-amber-300 border-t-amber-700" />
                  Bringing over {importInfo.photosTotal} photo
                  {importInfo.photosTotal === 1 ? "" : "s"} from your site…
                </p>
              ) : importInfo.photoCount > 0 ? (
                <p className="mt-2 text-xs text-amber-800">
                  {importInfo.photoCount} photo
                  {importInfo.photoCount === 1 ? "" : "s"} staged in the Photos
                  section below. Remove any you don&apos;t want, or add more.
                </p>
              ) : null}
              {importInfo.notes.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
                  {importInfo.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              {importInfo.nextName && (
                <p className="mt-2 text-xs text-amber-800">
                  Up next after you create this one: {importInfo.nextName}.
                </p>
              )}
              <button
                type="button"
                onClick={resetImport}
                className="mt-2 text-xs font-medium text-amber-900 underline hover:text-amber-700"
              >
                Start over with a blank form
              </button>
            </div>
          ) : (
            <ListingDraftImport onApply={applyDraft} />
          ))}

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {/* Listing Details */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Listing Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 relative" ref={addressRef}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address *
                </label>
                <div className="relative">
                  <input
                    name="address"
                    value={form.address}
                    onChange={handleAddressInput}
                    onFocus={() =>
                      addressSuggestions.length > 0 &&
                      setAddressDropdownOpen(true)
                    }
                    required
                    autoComplete="off"
                    className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 pr-8${importedCls("address")}`}
                    placeholder="123 Main St, St. Louis, MO 63130"
                  />
                  {addressLoading && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <svg
                        className="animate-spin h-4 w-4 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
                {addressDropdownOpen && addressSuggestions.length > 0 && (
                  <ul className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                    {addressSuggestions.map((s, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => selectAddressSuggestion(s)}
                          className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-red-50 active:bg-red-100 flex items-start gap-2 border-b border-gray-100 last:border-0"
                        >
                          <svg
                            className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          <span className="leading-snug">{s.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Display Name
                </label>
                <input
                  name="title"
                  value={form.title}
                  onChange={handleChange}
                  aria-invalid={fieldError?.field === "title" || undefined}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                    fieldError?.field === "title"
                      ? "border-red-500 focus:ring-red-500"
                      : "border-gray-300 focus:ring-red-500"
                  }${importedCls("title")}`}
                  placeholder="e.g. Cozy Studio Near Campus"
                />
                {fieldError?.field === "title" && (
                  <p className="mt-1 text-sm text-red-600">
                    {fieldError.message}
                    {fieldError.conflict?.address && (
                      <span className="text-gray-600">
                        {" "}
                        — already used by {fieldError.conflict.address}. Add
                        something that tells them apart, like the street.
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description *
                </label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  required
                  rows={3}
                  className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${importedCls("description")}`}
                  placeholder="Describe the property..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Home Type
                </label>
                <select
                  name="home_type"
                  value={form.home_type}
                  onChange={handleChange}
                  className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500${importedCls("home_type")}`}
                >
                  {HOME_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lease Type
                </label>
                <select
                  name="lease_type"
                  value={form.lease_type}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {LEASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              {/* Lease availability is now set per-unit (Lease Terms) and derived automatically. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Move-in Date
                </label>
                <input
                  type="date"
                  name="move_in_date"
                  value={form.move_in_date}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    name="furnished"
                    checked={form.furnished}
                    onChange={handleChange}
                    className="accent-red-600"
                  />
                  Furnished
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    name="sublease_friendly"
                    checked={form.sublease_friendly}
                    onChange={handleChange}
                    className="accent-red-600"
                  />
                  Sublease Friendly
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    name="twenty_one_plus"
                    checked={form.twenty_one_plus}
                    onChange={handleChange}
                    className="accent-red-600"
                  />
                  21+ Only
                </label>
              </div>
            </div>
          </div>

          {/* Amenities */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Amenities
            </h3>
            <div className="flex flex-wrap gap-2">
              {AMENITY_OPTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleMulti("amenities", a)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.amenities.includes(a)
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}
                >
                  {AMENITY_LABELS[a]}
                </button>
              ))}
              {customAmenities.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border bg-red-600 text-white border-red-600"
                >
                  {a}
                  <button
                    type="button"
                    onClick={() => removeCustomAmenity(a)}
                    className="ml-0.5 text-white/80 hover:text-white"
                    aria-label={`Remove ${a}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={customAmenityInput}
                onChange={(e) => setCustomAmenityInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomAmenity();
                  }
                }}
                placeholder="Add other amenity…"
                className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={addCustomAmenity}
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Add
              </button>
            </div>
          </div>

          {/* Utilities */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Utilities Included
            </h3>
            <div className="flex flex-wrap gap-2">
              {UTILITY_OPTIONS.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => toggleMulti("utilities_included", u)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.utilities_included.includes(u)
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}
                >
                  {UTILITY_LABELS[u]}
                </button>
              ))}
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Contact Info
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { name: "contact_name", label: "Name", type: "text" },
                { name: "contact_email", label: "Email", type: "email" },
                { name: "contact_phone", label: "Phone", type: "text" },
              ].map(({ name, label, type }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {label}
                  </label>
                  <input
                    name={name}
                    type={type}
                    value={form[name]}
                    onChange={handleChange}
                    className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${importedCls(name)}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Units */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Units *
              </h3>
              <button
                type="button"
                onClick={addUnit}
                className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium"
              >
                <Plus className="h-4 w-4" />
                Add Unit
              </button>
            </div>
            <div className="space-y-3">
              {units.map((unit, i) => (
                <div
                  key={i}
                  className="flex items-end gap-3 p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { field: "bedrooms", label: "Beds *", min: "0" },
                      {
                        field: "bathrooms",
                        label: "Baths *",
                        min: "0",
                        step: "0.5",
                      },
                      {
                        field: "rent",
                        label: "Rent ($/mo)",
                        min: "0",
                        hint: "Whole unit, not per person",
                      },
                      { field: "area", label: "Area (sq ft)", min: "0" },
                    ].map(({ field, label, min, step, hint }) => (
                      <div key={field}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          {label}
                        </label>
                        <input
                          type="number"
                          min={min}
                          step={step}
                          value={unit[field]}
                          onChange={(e) => updateUnit(i, field, clampCount(e.target.value))}
                          className={`w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${importedCls(`u${i}:${field}`)}`}
                        />
                        {hint && (
                          <p className="mt-1 text-[11px] leading-tight text-gray-400">
                            {hint}
                          </p>
                        )}
                      </div>
                    ))}
                    <div className="sm:col-span-4">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Unit / Floor Plan Name
                      </label>
                      <input
                        type="text"
                        value={unit.title ?? ""}
                        onChange={(e) => updateUnit(i, "title", e.target.value)}
                        placeholder='e.g. "The Loft" or "Penthouse A" (shown instead of "2 Bed / 1 Bath")'
                        className={`w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500${importedCls(`u${i}:title`)}`}
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Lease Terms: select all this unit is offered for
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {LEASE_TERM_PRESETS.map((p) => {
                          const on = (unit.leaseTermMonths || []).includes(p.months);
                          return (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => toggleUnitTerm(i, p.months)}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                on
                                  ? "bg-red-600 text-white border-red-600"
                                  : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                              }`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                        {/* Custom-month terms not covered by a preset */}
                        {(unit.leaseTermMonths || [])
                          .filter(
                            (m) => !LEASE_TERM_PRESETS.some((p) => p.months === m)
                          )
                          .map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-red-600 text-white border-red-600"
                            >
                              {m}-Month
                              <button
                                type="button"
                                onClick={() => removeUnitTerm(i, m)}
                                className="ml-0.5 text-white/80 hover:text-white"
                                aria-label={`Remove ${m}-month term`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        <input
                          type="number"
                          min="1"
                          value={customTermInput[i] ?? ""}
                          onChange={(e) =>
                            setCustomTermInput((prev) => ({
                              ...prev,
                              [i]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomUnitTerm(i);
                            }
                          }}
                          placeholder="Custom #"
                          className="w-24 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                        <button
                          type="button"
                          onClick={() => addCustomUnitTerm(i)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Floor Plan Image / PDF
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadFloorPlan(i, f);
                            e.target.value = "";
                          }}
                          className="text-xs text-gray-600 file:mr-2 file:rounded-md file:border-0 file:bg-gray-200 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-gray-300"
                        />
                        {floorPlanUploading[i] && (
                          <span className="text-xs text-gray-500">Uploading…</span>
                        )}
                        {unit.floorPlanImageUrl && !floorPlanUploading[i] && (
                          <>
                            <a
                              href={unit.floorPlanImageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-red-600 hover:underline"
                            >
                              View
                            </a>
                            <button
                              type="button"
                              onClick={() => updateUnit(i, "floorPlanImageUrl", "")}
                              className="text-xs text-gray-400 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 select-none sm:col-span-4">
                      <input
                        type="checkbox"
                        checked={unit.available !== false}
                        onChange={(e) =>
                          updateUnit(i, "available", e.target.checked)
                        }
                        className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      Available
                    </label>
                  </div>
                  {units.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeUnit(i)}
                      className="p-1.5 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Photos */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Photos
            </h3>

            {/* Existing images (edit mode) — drag to reorder */}
            {isEdit && existingImages.length > 0 && (
              <div className="mb-3">
                <DraggableImageGrid
                  images={existingImages}
                  onReorder={handleReorderExistingImages}
                  onRemove={removeExistingImage}
                  saving={savingImageOrder}
                />
              </div>
            )}

            {/* Street View default (new listings) */}
            {streetViewLoading && (
              <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5">
                <span className="w-3 h-3 border border-gray-300 border-t-red-500 rounded-full animate-spin" />
                Looking for a Street View photo…
              </p>
            )}
            {showStreetView && (
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="relative w-20 h-20 flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={streetView.url}
                    alt="Street View of the property"
                    className="w-full h-full object-cover rounded-lg border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setStreetViewDeleted(true)}
                    aria-label="Remove Street View photo"
                    className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center py-0.5 rounded-b-lg">
                    Street View
                  </div>
                </div>
              </div>
            )}

            {/* Staged previews */}
            {stagedPreviews.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {stagedPreviews.map((url, i) => (
                  <div key={i} className="relative w-20 h-20 flex-shrink-0">
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover rounded-lg border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => removeStagedImage(i)}
                      className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[9px] text-center py-0.5 rounded-b-lg">
                      new
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Drop / tap to upload */}
            <label
              className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 active:bg-red-50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleImageFiles(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)}
              />
              <Camera className="h-6 w-6 text-gray-400 mb-1" />
              <span className="text-sm text-gray-500 font-medium">
                Drop photos here or tap to browse
              </span>
              <span className="text-xs text-gray-400 mt-0.5">
                JPG, PNG, WebP (auto-compressed if large)
              </span>
            </label>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {submitting
                ? "Saving..."
                : isEdit
                ? "Save Changes"
                : "Create Listing"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
