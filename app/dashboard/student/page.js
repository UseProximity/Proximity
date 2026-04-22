"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Camera, X } from "lucide-react";
import { getRentRangeLabel, calcAge } from "@/utils/listingFormatters";

// ─── Add/Edit Sublease Modal ───────────────────────────────────────────────────

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

const emptyUnit = () => ({ bedrooms: "", bathrooms: "", rent: "", area: "" });

function AddEditListingModal({ listing, onClose, onSuccess, user }) {
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
    lease_availability: listing?.leaseAvailability ?? listing?.lease_availability ?? [],
  });
  const rawUnits = listing?.listing_units ?? listing?.unitTypes ?? [];
  const [units, setUnits] = useState(
    rawUnits.length
      ? rawUnits.map((u) => ({
          bedrooms: u.bedrooms ?? "",
          bathrooms: u.bathrooms ?? "",
          rent: u.rent ?? "",
          area: u.area ?? "",
        }))
      : [emptyUnit()]
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Image upload
  const [stagedFiles, setStagedFiles] = useState([]);
  const [stagedPreviews, setStagedPreviews] = useState([]);
  const [existingImages, setExistingImages] = useState(listing?.images ?? []);

  // Address autocomplete
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressDropdownOpen, setAddressDropdownOpen] = useState(false);
  const addressRef = useRef(null);
  const addressDebounceRef = useRef(null);

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

    setSubmitting(true);
    try {
      const unitPayload = units.map((u) => ({
        bedrooms: Number(u.bedrooms),
        bathrooms: Number(u.bathrooms),
        rent: u.rent !== "" ? Number(u.rent) : null,
        area: u.area !== "" ? Number(u.area) : null,
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
            utilities_included: form.utilities_included,
            lease_availability: form.lease_availability,
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
            contactEmail: form.contact_email || null,
            contactPhone: form.contact_phone || null,
            contactName: form.contact_name || null,
            leaseAvailability: form.lease_availability,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
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
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Lease Availability</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Semester",   value: "semester"  },
                    { label: "10-Month",   value: "10-month"  },
                    { label: "12-Month",   value: "12-month"  },
                    { label: "Summer",     value: "summer"    },
                  ].map(({ label, value }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleMulti("lease_availability", value)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        form.lease_availability.includes(value)
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-red-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
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
              <div className="flex flex-wrap gap-2 mb-3">
                {existingImages.map((url) => (
                  <div key={url} className="relative w-20 h-20 flex-shrink-0">
                    <img src={url} alt="" className="w-full h-full object-cover rounded-lg border border-gray-200" />
                    <button type="button" onClick={() => removeExistingImage(url)}
                      className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {stagedPreviews.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {stagedPreviews.map((url, i) => (
                  <div key={i} className="relative w-20 h-20 flex-shrink-0">
                    <img src={url} alt="" className="w-full h-full object-cover rounded-lg border border-gray-200" />
                    <button type="button" onClick={() => removeStagedImage(i)}
                      className="absolute -top-1.5 -right-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-white text-[9px] text-center py-0.5 rounded-b-lg">new</div>
                  </div>
                ))}
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

function SubleaseCard({ listing, onEdit, onDelete, deleting }) {
  const addressBeforeComma = (listing.address || "").split(",")[0].trim();
  const title = listing.title || addressBeforeComma;
  const cityStateZip = (listing.title && listing.title !== addressBeforeComma)
    ? (listing.address || "")
    : (listing.address || "").replace(/^[^,]+,\s*/, "");
  const imageUrl = listing.images?.[0];

  return (
    <div className="relative bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100 flex flex-col">
      <div className="relative">
        {imageUrl ? (
          <img src={imageUrl} alt={listing.address} className="w-full aspect-video object-cover" />
        ) : (
          <div className="w-full aspect-video bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
            No image
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="bg-red-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full capitalize">
            {listing.leaseType || "sublease"}
          </span>
        </div>
      </div>
      <div className="p-3 bg-[#fafafa] flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-gray-900 leading-snug truncate">{title}</h3>
            {cityStateZip && <p className="text-xs text-gray-500 mt-0.5 truncate">{cityStateZip}</p>}
          </div>
          <span className="text-red-500 font-bold text-sm whitespace-nowrap flex-shrink-0">
            {getRentRangeLabel(listing.unitTypes)}
            {getRentRangeLabel(listing.unitTypes) !== "Contact for Pricing" && (
              <span className="text-xs font-normal">/mo</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-auto pt-2 border-t border-gray-100">
          <Link
            href={`/browse?listing=${listing._id}`}
            className="flex-1 text-center text-xs font-medium text-gray-600 hover:text-gray-900 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
          >
            View
          </Link>
          <button
            onClick={() => onEdit(listing)}
            className="flex-1 text-center text-xs font-medium text-blue-600 hover:text-blue-800 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(listing._id || listing.id)}
            disabled={deleting}
            className="flex-1 text-center text-xs font-medium text-red-600 hover:text-red-800 py-1.5 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {deleting ? "..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Profile Modal ────────────────────────────────────────────────────────

function EditProfileModal({ user, onClose, onSaved }) {
  const { update: updateSession } = useSession();
  const router = useRouter();
  const initialRole = (user.role || "student").toLowerCase();
  const [form, setForm] = useState({
    name: user.name || "",
    birthday: user.birthday
      ? new Date(user.birthday).toISOString().split("T")[0]
      : "",
    gender: (user.gender || "unspecified").toLowerCase(),
    role: initialRole,
    phone: user.phone || "",
    description: user.description || "",
    referralSource: user.referralSource || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(user.image || null);
  const fileInputRef = useRef(null);

  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits.length ? `(${digits}` : "";
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  function handleChange(e) {
    const { name, value } = e.target;
    if (name === "phone") {
      setForm((prev) => ({ ...prev, phone: formatPhone(value) }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let imageUrl = user.image || null;
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        const uploadRes = await fetch("/api/uploadProfilePhoto", {
          method: "POST",
          body: fd,
        });
        if (!uploadRes.ok) throw new Error("Photo upload failed");
        const uploadData = await uploadRes.json();
        imageUrl = uploadData.url;
      }

      const res = await fetch("/api/editProfile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          birthday: form.birthday || undefined,
          ...(imageUrl !== undefined && { image: imageUrl }),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      const updated = await res.json();
      onSaved(updated);

      // If role changed, push the new role into the JWT and route them to
      // the correct dashboard. Without this the session still thinks they're
      // a student and Header + dashboard layout redirects break.
      const newRole = (updated?.role ?? form.role ?? "").toLowerCase();
      if (newRole && newRole !== initialRole) {
        await updateSession({ role: newRole });
        if (newRole === "landlord") {
          router.replace("/dashboard/landlord");
          return;
        }
        if (newRole === "admin" || newRole === "super") {
          router.replace("/dashboard/admin");
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="text-lg font-bold text-gray-900 mb-5">Edit Profile</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Profile Picture */}
          <div className="flex flex-col items-center gap-2">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-gray-200 cursor-pointer group"
            >
              {photoPreview ? (
                <img src={photoPreview} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                </svg>
              </div>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="text-xs text-red-500 font-semibold hover:text-red-600">
              {photoPreview ? "Change Photo" : "Add Photo"}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
            <input type="text" name="name" value={form.name} onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
          </div>

          {/* Birthday + Gender row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Birthday</label>
              <input type="date" name="birthday" max={new Date().toISOString().split("T")[0]}
                value={form.birthday} onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Gender</label>
              <select name="gender" value={form.gender} onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
                <option value="unspecified">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">I am a</label>
            <select name="role" value={form.role} onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
              <option value="student">Student</option>
              <option value="landlord">Landlord</option>
              {user.role === "super" && <option value="super">Super</option>}
            </select>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
            <input type="tel" name="phone" value={form.phone} onChange={handleChange}
              placeholder="e.g. (314) 555-0100"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bio</label>
            <textarea name="description" value={form.description} onChange={handleChange} rows={3}
              placeholder="Tell landlords a bit about yourself…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
          </div>

          {/* How'd you find us */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">How&apos;d you find us?</label>
            <select name="referralSource" value={form.referralSource} onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
              <option value="">Not specified</option>
              <option value="Social Media">Social Media</option>
              <option value="A Friend">A Friend</option>
              <option value="Colleague">Colleague</option>
              <option value="On Campus">On Campus</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Shared listing card (same style as browse/popular) ──────────────────────

function ListingCard({ listing, badge }) {
  const pathname = usePathname();
  const addressBeforeComma = (listing.address || "").split(",")[0].trim();
  const title = listing.title || addressBeforeComma;
  const cityStateZip = (listing.title && listing.title !== addressBeforeComma)
    ? (listing.address || "")
    : (listing.address || "").replace(/^[^,]+,\s*/, "");
  const bedValues = listing.unitTypes
    .map((u) => u.bedrooms)
    .filter(Number.isFinite);
  const bathValues = listing.unitTypes
    .map((u) => u.bathrooms)
    .filter(Number.isFinite);
  const bedLabel =
    bedValues.length === 0
      ? "N/A"
      : Math.min(...bedValues) === Math.max(...bedValues)
      ? String(Math.min(...bedValues))
      : `${Math.min(...bedValues)}-${Math.max(...bedValues)}`;
  const bathLabel =
    bathValues.length === 0
      ? "N/A"
      : Math.min(...bathValues) === Math.max(...bathValues)
      ? String(Math.min(...bathValues))
      : `${Math.min(...bathValues)}-${Math.max(...bathValues)}`;
  const imageUrl = listing.images?.[0];
  const imageCount = listing.images?.length || 0;

  return (
    <Link href={`${pathname}?listing=${listing._id}`} className="group block">
      <div className="relative bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100 hover:border-red-200 transition-colors duration-200 flex flex-col">
        <div className="relative">
          {imageUrl ? (
            <img src={imageUrl} alt={listing.address} className="w-full aspect-video object-cover" />
          ) : (
            <div className="w-full aspect-video bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
              No image
            </div>
          )}
          {imageCount > 1 && (
            <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
              See all {imageCount} photos
            </div>
          )}
          {badge && (
            <div className="absolute top-3 right-3 bg-white rounded-full p-1 shadow-md">
              {badge}
            </div>
          )}
        </div>
        <div className="p-3 bg-[#fafafa] flex flex-col flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm text-gray-900 leading-snug">{title}</h3>
              {cityStateZip && <p className="text-xs text-gray-500 mt-0.5">{cityStateZip}</p>}
            </div>
            <span className="text-red-500 font-bold text-sm whitespace-nowrap flex-shrink-0">
              {getRentRangeLabel(listing.unitTypes)}
              {getRentRangeLabel(listing.unitTypes) !== "Contact for Pricing" && (
                <span className="text-xs font-normal">/mo</span>
              )}
            </span>
          </div>
          <div className="mt-auto pt-2">
            <span className="text-gray-500 text-xs">
              {bedLabel} bed {" | "} {bathLabel} bath
              {listing.leaseAvailability ? ` | ${listing.leaseAvailability}` : ""}
            </span>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
      </div>
    </Link>
  );
}

// Green checkmark badge for contacted cards
const CheckBadge = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ─── Icon SVGs ────────────────────────────────────────────────────────────────

const BellIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const ClockIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ─── Main page ────────────────────────────────────────────────────────────────

const CARDS_PER_PAGE = 2;
const SUBLEASES_PER_PAGE = 4;

export default function StudentDashboardPage({ initialViewAsId } = {}) {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dbUser, setDbUser] = useState(null);
  const [contactedPage, setContactedPage] = useState(0);
  const [subleasePage, setSubleasePage] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [subleaseModal, setSubleaseModal] = useState(null); // null | { mode: "add" } | { mode: "edit", listing }
  const [deletingId, setDeletingId] = useState(null);
  const [showRoleOverlay, setShowRoleOverlay] = useState(false);

  const notifRef = useRef(null);
  const activityRef = useRef(null);

  // Lock viewAsId on mount — never let URL changes reset it
  const viewAsIdRef = useRef(initialViewAsId ?? searchParams.get("viewAs"));
  const viewAsId = viewAsIdRef.current;
  const isViewingAs = !!viewAsId;

  useEffect(() => {
    const url = isViewingAs
      ? `/api/admin/viewUser?id=${encodeURIComponent(viewAsId)}`
      : "/api/getUser";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (!data?.error) setDbUser(data);
      })
      .catch(console.error);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle ?addSublease=1 param — open modal or show role overlay
  useEffect(() => {
    if (searchParams.get("addSublease") !== "1") return;
    if (!dbUser) return; // wait for user to load

    if (dbUser.role === "student" || dbUser.role === "super") {
      setSubleaseModal({ mode: "add" });
    } else {
      setShowRoleOverlay(true);
    }

    // Clean the query param from the URL without a page reload
    const url = new URL(window.location.href);
    url.searchParams.delete("addSublease");
    router.replace(url.pathname + (url.search || ""), { scroll: false });
  }, [searchParams, dbUser, router]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target))
        setNotifOpen(false);
      if (activityRef.current && !activityRef.current.contains(e.target))
        setActivityOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const user = {
    _id: dbUser?._id ?? null,
    name: dbUser?.name ?? session?.user?.name ?? null,
    email: dbUser?.email ?? session?.user?.email ?? null,
    image: dbUser?.image ?? session?.user?.image ?? null,
    createdAt: dbUser?.createdAt ?? null,
    numReviews: dbUser?.numReviews ?? 0,
    listings: dbUser?.listings ?? [],
    favorites: dbUser?.favorites ?? [],
    contacted: dbUser?.contacted ?? [],
    birthday: dbUser?.birthday ?? null,
    gender: dbUser?.gender ?? null,
    role: dbUser?.role ?? session?.user?.role ?? "student",
    phone: dbUser?.phone ?? null,
    description: dbUser?.description ?? null,
  };

  const contacted = user.contacted;
  const favorites = user.favorites;
  const subleases = user.listings;

  const joinedDate = user.createdAt
    ? new Date(user.createdAt)
    : user._id
    ? new Date(parseInt(user._id.substring(0, 8), 16) * 1000)
    : null;
  const joinedYear = joinedDate
    ? joinedDate.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  const contactedPages = Math.max(1, Math.ceil(contacted.length / CARDS_PER_PAGE));
  const contactedVisible = contacted.slice(
    contactedPage * CARDS_PER_PAGE,
    contactedPage * CARDS_PER_PAGE + CARDS_PER_PAGE
  );

  const subleasePages = Math.max(1, Math.ceil(subleases.length / SUBLEASES_PER_PAGE));
  const subleasesVisible = subleases.slice(
    subleasePage * SUBLEASES_PER_PAGE,
    subleasePage * SUBLEASES_PER_PAGE + SUBLEASES_PER_PAGE
  );

  async function handleDeleteSublease(listingId) {
    if (!confirm("Delete this listing? This cannot be undone.")) return;
    setDeletingId(listingId);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDbUser((prev) => ({
          ...prev,
          listings: (prev?.listings ?? []).filter(
            (l) => (l._id || l.id) !== listingId
          ),
        }));
      }
    } finally {
      setDeletingId(null);
    }
  }

  function handleSubleaseSuccess() {
    setSubleaseModal(null);
    // Refresh user data to pick up the new/edited listing
    fetch("/api/getUser")
      .then((r) => r.json())
      .then((data) => { if (!data?.error) setDbUser(data); })
      .catch(console.error);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {isViewingAs && dbUser && (
        <div className="bg-gray-900 text-white px-6 py-2 flex items-center justify-between text-sm">
          <span>
            Viewing as <span className="font-semibold">{dbUser.name || dbUser.email}</span>
            <span className="ml-2 text-gray-400 font-mono text-xs">{dbUser.id}</span>
          </span>
          <a href="/dashboard/admin" className="text-gray-300 hover:text-white underline">← Exit</a>
        </div>
      )}
      <div className="max-w-screen-2xl mx-auto px-4 py-6 md:px-10 md:py-10">
        {/* Title bar */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">My Account</h1>

          {/* Banner icon dropdowns — mobile only */}
          <div className="flex items-center gap-2 md:hidden">
            {/* Recent Activity dropdown */}
            <div ref={activityRef}>
              <button
                onClick={() => { setActivityOpen((o) => !o); setNotifOpen(false); }}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Recent Activity"
              >
                <ClockIcon className="w-5 h-5" />
              </button>
              {activityOpen && (
                <div className="fixed left-1/2 -translate-x-1/2 top-24 w-[80vw] bg-white rounded-xl border border-gray-200 shadow-lg z-40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ClockIcon className="w-4 h-4 text-gray-700" />
                      <h3 className="font-semibold text-gray-900 text-sm">Recent Activity</h3>
                    </div>
                    <button onClick={() => setActivityOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="text-center py-6 text-gray-400 text-sm">No recent activity</div>
                </div>
              )}
            </div>

            {/* Notifications dropdown */}
            <div ref={notifRef}>
              <button
                onClick={() => { setNotifOpen((o) => !o); setActivityOpen(false); }}
                className="p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Notifications"
              >
                <BellIcon className="w-5 h-5" />
              </button>
              {notifOpen && (
                <div className="fixed left-1/2 -translate-x-1/2 top-24 w-[80vw] bg-white rounded-xl border border-gray-200 shadow-lg z-40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <BellIcon className="w-4 h-4 text-gray-700" />
                      <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
                    </div>
                    <button onClick={() => setNotifOpen(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="text-center py-6 text-gray-400 text-sm">No new notifications</div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-b border-gray-200 mb-8" />

        {/* Two-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2.5fr] gap-10 items-start">
          {/* ── LEFT COLUMN ── */}
          <div className="space-y-5">
            {/* Profile card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex flex-col items-center text-center relative">

                {user?.image ? (
                  <img src={user.image} alt={user.name}
                    className="w-32 h-32 rounded-full object-cover border border-gray-200 shadow mb-4" />
                ) : (
                  <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  </div>
                )}

                <h2 className="font-bold text-gray-900 text-xl md:text-2xl leading-tight">{user?.name || "—"}</h2>
                <p className="text-base md:text-lg text-gray-500 mt-0.5 capitalize">{user.role || "Student"}</p>
                {(user.birthday || (user.gender && user.gender !== "unspecified")) && (
                  <p className="text-sm md:text-base text-gray-400 mt-0.5">
                    {[
                      calcAge(user.birthday) != null ? `Age ${calcAge(user.birthday)}` : null,
                      user.gender && user.gender !== "unspecified" ? user.gender : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-sm md:text-base text-gray-400 mt-0.5">Washington University in St. Louis</p>

                <div className="w-full border-t border-gray-100 mt-4 pt-4 flex justify-around">
                  <div className="text-center">
                    <p className="font-semibold text-gray-800 text-sm md:text-base">Joined {joinedYear}</p>
                  </div>
                </div>
                <div className="w-full flex justify-around mt-3">
                  <div className="text-center">
                    <p className="font-semibold text-gray-800 text-sm md:text-base">{user?.numReviews ?? 0}</p>
                    <p className="text-xs md:text-sm text-gray-400">Posts</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-gray-800 text-sm md:text-base">{subleases.length}</p>
                    <p className="text-xs md:text-sm text-gray-400">Subleases</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditOpen(true)}
                  className="mt-4 w-full py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Edit Profile
                </button>
              </div>
            </div>

            {/* Notifications card — desktop only */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <BellIcon className="w-4 h-4 text-gray-700" />
                <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
              </div>
              <div className="text-center py-6 text-gray-400 text-sm">No new notifications</div>
            </div>

            {/* Recent Activity card — desktop only */}
            <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <ClockIcon className="w-4 h-4 text-gray-700" />
                <h3 className="font-semibold text-gray-900 text-sm">Recent Activity</h3>
              </div>
              <div className="text-center py-6 text-gray-400 text-sm">No recent activity</div>
            </div>

            {/* Admin Dashboard link — super only */}
            {user.role === "super" && (
              <a href="/dashboard/admin" target="_blank" rel="noopener noreferrer"
                className="block bg-gray-900 hover:bg-gray-800 transition-colors rounded-xl border border-gray-700 shadow-sm p-5 text-center">
                <p className="font-semibold text-white text-sm">Admin Dashboard</p>
                <p className="text-xs text-gray-400 mt-1">Opens in new tab</p>
              </a>
            )}
            {user.role === "super" && (
              <a href="/dashboard/admin?table=reviews&filter=pending" target="_blank" rel="noopener noreferrer"
                className="block bg-gray-900 hover:bg-gray-800 transition-colors rounded-xl border border-gray-700 shadow-sm p-5 text-center">
                <p className="font-semibold text-white text-sm">Pending Reviews</p>
                <p className="text-xs text-gray-400 mt-1">Opens in new tab</p>
              </a>
            )}
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="space-y-8">
            {/* Contacted section */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h2 className="text-lg font-bold text-gray-900">Contacted</h2>
              </div>
              <div className="border-b border-gray-200 mb-4" />

              {contacted.length === 0 ? (
                <div>
                  <p className="text-sm text-gray-500 mb-6">
                    You haven&apos;t contacted any leasing agents yet. Browse listings to get started.
                  </p>
                  <Link href="/browse"
                    className="inline-block px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">
                    Browse Listings
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    Congrats, you&apos;ve reached out to the leasing agent. Check your email and phone number for updates.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-4">
                    {contactedVisible.map((listing) => (
                      <ListingCard key={listing._id} listing={listing} badge={<CheckBadge />} />
                    ))}
                  </div>
                  {contactedPages > 1 && (
                    <div className="flex items-center gap-1 text-sm">
                      {Array.from({ length: contactedPages }, (_, i) => (
                        <button key={i} onClick={() => setContactedPage(i)}
                          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                            i === contactedPage ? "font-bold text-gray-900 underline" : "text-gray-500 hover:text-gray-800"
                          }`}>
                          {i + 1}
                        </button>
                      ))}
                      {contactedPage < contactedPages - 1 && (
                        <button onClick={() => setContactedPage((p) => Math.min(p + 1, contactedPages - 1))}
                          className="ml-1 text-gray-500 hover:text-gray-800">
                          Next
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Saved Lists section */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                <h2 className="text-lg font-bold text-gray-900">Saved Lists</h2>
              </div>
              <div className="border-b border-gray-200 mb-4" />

              {favorites.length === 0 ? (
                <div>
                  <p className="text-sm text-gray-500 mb-6">
                    You haven&apos;t saved any listings yet. Heart a listing while browsing to save it here.
                  </p>
                  <Link href="/browse"
                    className="inline-block px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors">
                    Browse Listings
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    Psst... Don&apos;t forget about these listings! Follow-up before they get signed!
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                    {favorites.slice(0, 4).map((listing) => (
                      <ListingCard key={listing._id} listing={listing} />
                    ))}
                  </div>
                  {favorites.length > 4 && (
                    <Link href="/browse" className="group relative block w-full rounded-2xl overflow-hidden shadow-md">
                      {favorites[4]?.images?.[0] && (
                        <img src={favorites[4].images[0]} alt="View all saved"
                          className="w-full h-40 object-cover brightness-50" />
                      )}
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-3">
                        <span className="text-white text-lg font-bold">View All Saved Listings</span>
                        <div className="bg-red-600 rounded-full p-2">
                          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </div>
                      </div>
                    </Link>
                  )}
                </>
              )}
            </div>

            {/* ── My Subleases section ── */}
            {(user.role === "student" || user.role === "super") && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    <h2 className="text-lg font-bold text-gray-900">My Subleases</h2>
                  </div>
                  <button
                    onClick={() => setSubleaseModal({ mode: "add" })}
                    className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Sublease
                  </button>
                </div>
                <div className="border-b border-gray-200 mb-4" />

                {subleases.length === 0 ? (
                  <div>
                    <p className="text-sm text-gray-500 mb-6">
                      You haven&apos;t posted any subleases yet. Click &ldquo;Add Sublease&rdquo; to list your space.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-4">
                      {subleasesVisible.map((listing) => (
                        <SubleaseCard
                          key={listing._id}
                          listing={listing}
                          onEdit={(l) => setSubleaseModal({ mode: "edit", listing: l })}
                          onDelete={handleDeleteSublease}
                          deleting={deletingId === (listing._id || listing.id)}
                        />
                      ))}
                    </div>
                    {subleasePages > 1 && (
                      <div className="flex items-center gap-1 text-sm">
                        {Array.from({ length: subleasePages }, (_, i) => (
                          <button key={i} onClick={() => setSubleasePage(i)}
                            className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                              i === subleasePage ? "font-bold text-gray-900 underline" : "text-gray-500 hover:text-gray-800"
                            }`}>
                            {i + 1}
                          </button>
                        ))}
                        {subleasePage < subleasePages - 1 && (
                          <button onClick={() => setSubleasePage((p) => Math.min(p + 1, subleasePages - 1))}
                            className="ml-1 text-gray-500 hover:text-gray-800">
                            Next
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit profile modal */}
      {editOpen && (
        <EditProfileModal
          user={user}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setDbUser((prev) => ({
              ...prev,
              name: updated.name,
              birthday: updated.birthday,
              gender: updated.gender,
              role: updated.role,
              phone: updated.phone,
              description: updated.description,
            }));
          }}
        />
      )}

      {/* Add/Edit sublease modal */}
      {subleaseModal && (
        <AddEditListingModal
          listing={subleaseModal.mode === "edit" ? subleaseModal.listing : null}
          onClose={() => setSubleaseModal(null)}
          onSuccess={handleSubleaseSuccess}
          user={user}
        />
      )}

      {/* "Must be student" role overlay */}
      {showRoleOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Students Only</h2>
            <p className="text-sm text-gray-500 mb-6">
              Adding a sublease is only available to student accounts. Please log in with a student account to continue.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => signIn(undefined, { callbackUrl: "/dashboard/student?addSublease=1" })}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Login as Student
              </button>
              <button
                onClick={() => { setShowRoleOverlay(false); router.push("/"); }}
                className="w-full border border-gray-200 text-gray-600 hover:bg-gray-50 font-semibold py-2.5 rounded-xl transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
