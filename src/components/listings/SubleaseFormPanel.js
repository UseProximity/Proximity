"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, Plus, X } from "lucide-react";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";

// Values are the exact boolean column names on `listing_amenities` / `listing_utilities`.
const AMENITY_OPTIONS = [
  "air_conditioning", "dishwasher", "gym", "laundry", "mailroom",
  "microwave", "oven", "parking", "pets_allowed", "pool",
  "refrigerator", "rooftop", "storage", "stove", "study_room",
];
const AMENITY_LABELS = {
  air_conditioning: "Air Conditioning",
  dishwasher:       "Dishwasher",
  gym:              "Gym",
  laundry:          "Laundry",
  mailroom:         "Mailroom",
  microwave:        "Microwave",
  oven:             "Oven",
  parking:          "Parking",
  pets_allowed:     "Pets Allowed",
  pool:             "Pool",
  refrigerator:     "Refrigerator",
  rooftop:          "Rooftop",
  storage:          "Storage",
  stove:            "Stove",
  study_room:       "Study Room",
};
const UTILITY_OPTIONS = [
  "electric", "gas", "heat", "water", "internet",
  "trash", "cable", "sewer", "cooling",
];
const UTILITY_LABELS = {
  electric: "Electric",
  gas:      "Gas",
  heat:     "Heat",
  water:    "Water",
  internet: "Internet",
  trash:    "Trash",
  cable:    "Cable",
  sewer:    "Sewer",
  cooling:  "Cooling",
};
const HOME_TYPES = ["apartment", "house", "condo", "townhouse", "studio", "other"];
const LEASE_TYPES = ["sublease", "standard", "short-term"];

const emptyUnit = () => ({
  bedrooms: "",
  bathrooms: "",
  rent: "",
  area: "",
  available: true,
  title: "",
  floorPlanImageUrl: "",
  leaseTermMonths: [], // months a unit can be leased for (multi-select)
});

// Named lease-term presets map to month counts; students can also type any number.
const LEASE_TERM_PRESETS = [
  { label: "Summer", months: 4 },
  { label: "Semester", months: 5 },
  { label: "10-Month", months: 10 },
  { label: "12-Month", months: 12 },
];

// Shared add/edit sublease form for students. Renders as a modal by default
// (used for editing inside the dashboard) or as a full-page form when `asPage`
// is true (used by the standalone /add-sublease page).
export default function SubleaseFormPanel({
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
    home_type: listing?.home_type ?? listing?.homeType ?? "apartment",
    lease_type: listing?.lease_type ?? listing?.leaseType ?? "sublease",
    furnished: listing?.furnished ?? false,
    sublease_friendly: listing?.sublease_friendly ?? listing?.subleaseFriendly ?? false,
    move_in_date: listing?.move_in_date ?? (listing?.moveInDate ? listing.moveInDate.slice(0, 10) : ""),
    contact_email: listing?.contact_email ?? listing?.contactEmail ?? user?.email ?? "",
    contact_phone: listing?.contact_phone ?? listing?.contactPhone ?? user?.phone ?? "",
    contact_name: listing?.contact_name ?? listing?.contactName ?? user?.name ?? "",
    amenities: listing?.amenities ?? [],
    utilities_included: listing?.utilities_included ?? listing?.utilitiesIncluded ?? [],
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

  // Image upload
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedPreviews, setStagedPreviews] = useState([]);
  const [existingImages, setExistingImages] = useState(listing?.images ?? []);
  const stagedPreviewsRef = useRef([]);

  // Address autocomplete
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const addressRef = useRef(null);
  const addressDebounceRef = useRef(null);

  useEffect(() => {
    stagedPreviewsRef.current = stagedPreviews;
  }, [stagedPreviews]);

  // Cleanup: cancel pending debounced requests and release object URLs on unmount.
  useEffect(() => {
    return () => {
      if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
      for (const url of stagedPreviewsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

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
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=5&country=US&types=address,place`
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
    setForm((f) => ({ ...f, address: value }));
    fetchAddressSuggestions(value);
  };

  const selectAddressSuggestion = (suggestion) => {
    const autoTitle = suggestion.label.split(",")[0].trim();
    setForm((f) => ({
      ...f,
      address: suggestion.label,
      title: (!f.title || f.title === (f.address || "").split(",")[0].trim()) ? autoTitle : f.title,
    }));
    setAddressSuggestions([]);
    setAddressDropdownOpen(false);
  };

  const compressImage = (file) =>
    new Promise((resolve) => {
      if (file.size < 1 * 1024 * 1024) { resolve(file); return; }
      const img = new Image();
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
            if (!blob || blob.size >= file.size) { resolve(file); return; }
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
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

  // Drag-reorder staged (not-yet-uploaded) photos — keep files + previews in lockstep.
  const handleReorderStaged = (nextUrls) => {
    const order = nextUrls.map((u) => stagedPreviews.indexOf(u));
    setStagedFiles((prev) => order.map((idx) => prev[idx]).filter(Boolean));
    setStagedPreviews((prev) => order.map((idx) => prev[idx]).filter(Boolean));
  };

  const [savingImageOrder, setSavingImageOrder] = useState(false);
  // Drag-reorder existing photos (edit mode) — persist sort_order to the server.
  const handleReorderExisting = async (nextUrls) => {
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
      if (!res.ok) setExistingImages(prev);
    } catch {
      setExistingImages(prev);
    } finally {
      setSavingImageOrder(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
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
  const updateUnit = (i, field, val) =>
    setUnits((u) =>
      u.map((unit, idx) => (idx === i ? { ...unit, [field]: val } : unit))
    );

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!form.address.trim()) { setError("Address is required."); return; }
    if (!form.description.trim()) { setError("Description is required."); return; }
    if (units.length === 0) { setError("At least one unit is required."); return; }
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
        res = await fetch(`/api/landlord/listings/${listing._id || listing.id}`, {
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
            move_in_date: form.move_in_date || null,
            contact_email: form.contact_email || null,
            contact_phone: form.contact_phone || null,
            contact_name: form.contact_name || null,
            amenities: form.amenities,
            custom_amenities: customAmenities,
            utilities_included: form.utilities_included,
            // lease_availability is derived server-side from each unit's lease terms
            images: existingImages,
            units: unitPayload,
          }),
        });
      } else {
        res = await fetch("/api/addListing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            unitTypes: unitPayload,
            customAmenities,
            contactEmail: form.contact_email || null,
            contactPhone: form.contact_phone || null,
            contactName: form.contact_name || null,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong."); return; }

      // Upload staged images via presigned URLs so files go directly from the
      // browser to R2, bypassing Vercel's 4.5 MB serverless body limit.
      if (stagedFiles.length > 0) {
        const listingId = isEdit
          ? (listing._id || listing.id)
          : data.listing?.id;
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
            setError(`Listing saved, but images failed to upload: ${presignData.error || `server error ${presignRes.status}`}`);
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
          const failedUploads = uploadResults.filter((r) => r.status === "rejected" || !r.value?.ok);
          if (failedUploads.length > 0) {
            setError(`Listing saved, but ${failedUploads.length} image(s) failed to upload. Please try re-uploading them.`);
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
            setError(`Listing saved, but images were uploaded and could not be saved: ${confirmData.error || `server error ${confirmRes.status}`}`);
            setSubmitting(false);
            return;
          }
        }
      }

      onSuccess();
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
            {isEdit ? "Edit Sublease" : "Add Sublease"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* Listing Details */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Listing Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 relative" ref={addressRef}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address *</label>
                <div className="relative">
                  <input
                    name="address"
                    value={form.address}
                    onChange={handleAddressInput}
                    onFocus={() => addressSuggestions.length > 0 && setAddressDropdownOpen(true)}
                    required
                    autoComplete="off"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 pr-8"
                    placeholder="123 Main St, St. Louis, MO 63130"
                  />
                  {addressLoading && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
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
                          <svg className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <span className="leading-snug">{s.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
                <input
                  name="title" value={form.title} onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="e.g. Cozy Studio Near Campus"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                <textarea
                  name="description" value={form.description} onChange={handleChange} required rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Describe the property..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Home Type</label>
                <select
                  name="home_type" value={form.home_type} onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {HOME_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lease Type</label>
                <select
                  name="lease_type" value={form.lease_type} onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  {LEASE_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Move-in Date</label>
                <input
                  type="date" name="move_in_date" value={form.move_in_date} onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              {/* Lease availability is now set per-unit (Lease Terms) and derived automatically. */}
              <div className="flex items-center gap-4 pt-5">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" name="furnished" checked={form.furnished} onChange={handleChange} className="accent-red-600" />
                  Furnished
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" name="sublease_friendly" checked={form.sublease_friendly} onChange={handleChange} className="accent-red-600" />
                  Sublease Friendly
                </label>
              </div>
            </div>
          </div>

          {/* Amenities */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Amenities</h3>
            <div className="flex flex-wrap gap-2">
              {AMENITY_OPTIONS.map((a) => (
                <button key={a} type="button" onClick={() => toggleMulti("amenities", a)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.amenities.includes(a)
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}>
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
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Utilities Included</h3>
            <div className="flex flex-wrap gap-2">
              {UTILITY_OPTIONS.map((u) => (
                <button key={u} type="button" onClick={() => toggleMulti("utilities_included", u)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.utilities_included.includes(u)
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                  }`}>
                  {UTILITY_LABELS[u]}
                </button>
              ))}
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Contact Info</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { name: "contact_name", label: "Name", type: "text" },
                { name: "contact_email", label: "Email", type: "email" },
                { name: "contact_phone", label: "Phone", type: "text" },
              ].map(({ name, label, type }) => (
                <div key={name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    name={name} type={type} value={form[name]} onChange={handleChange}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Units */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Units *</h3>
              <button type="button" onClick={addUnit}
                className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium">
                <Plus className="h-4 w-4" />
                Add Unit
              </button>
            </div>
            <div className="space-y-3">
              {units.map((unit, i) => (
                <div key={i} className="flex items-end gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { field: "bedrooms", label: "Beds *", min: "0" },
                      { field: "bathrooms", label: "Baths *", min: "0", step: "0.5" },
                      { field: "rent", label: "Rent ($/mo)", min: "0" },
                      { field: "area", label: "Area (sq ft)", min: "0" },
                    ].map(({ field, label, min, step }) => (
                      <div key={field}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                        <input
                          type="number" min={min} step={step} value={unit[field]}
                          onChange={(e) => updateUnit(i, field, e.target.value)}
                          className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
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
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Lease Terms — select all this unit is offered for
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
                    <button type="button" onClick={() => removeUnit(i)}
                      className="p-1.5 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Photos */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Photos</h3>

            {isEdit && existingImages.length > 0 && (
              <div className="mb-3">
                <DraggableImageGrid
                  images={existingImages}
                  onReorder={handleReorderExisting}
                  onRemove={removeExistingImage}
                  saving={savingImageOrder}
                />
              </div>
            )}

            {stagedPreviews.length > 0 && (
              <div className="mb-3">
                <DraggableImageGrid
                  images={stagedPreviews}
                  onReorder={handleReorderStaged}
                  onRemove={(url) =>
                    removeStagedImage(stagedPreviews.indexOf(url))
                  }
                />
              </div>
            )}

            <label
              className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleImageFiles(e.dataTransfer.files); }}
            >
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)} />
              <Camera className="h-6 w-6 text-gray-400 mb-1" />
              <span className="text-sm text-gray-500 font-medium">Drop photos here or tap to browse</span>
              <span className="text-xs text-gray-400 mt-0.5">JPG, PNG, WebP — auto-compressed if large</span>
            </label>
          </div>

          {/* Footer */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button type="submit" disabled={submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
              {submitting ? "Saving..." : isEdit ? "Save Changes" : "Post Sublease"}
            </button>
            <button type="button" onClick={onClose}
              className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sublease listing card (with edit/delete/view actions) ────────────────────

