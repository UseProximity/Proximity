"use client";

import axios from "axios";
import { useState, useEffect, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";

export default function AddListing() {
  const [isLoading, setIsLoading] = useState(false);

  const [formData, setFormData] = useState({
    address: "",
    longitude: "",
    latitude: "",
    unitTypes: [],
    description: "",
    leaseStructure: "",
    leaseAvailability: "",
    moveInDate: "",
    homeType: "",
    amenities: [],
    furnished: "",
    utilitiesIncluded: [],
    subleaseFriendly: false,
    twentyOnePlus: false,
    images: [],
  });

  const [unitTypes, setUnitTypes] = useState([
    { name: "", rent: "", area: "", bedrooms: "", bathrooms: "", available: true, floorPlanImageUrl: "", leaseTermMonths: [] },
  ]);

  const [imagePreviews, setImagePreviews] = useState([]);

  const [customAmenities, setCustomAmenities] = useState([]);
  const [customAmenityInput, setCustomAmenityInput] = useState("");
  const [floorPlanUploading, setFloorPlanUploading] = useState({});

  // Named lease-term presets map to month counts; landlords can also type any number.
  const leaseTermPresets = [
    { label: "Summer", months: 4 },
    { label: "Semester", months: 5 },
    { label: "10-Month", months: 10 },
    { label: "12-Month", months: 12 },
  ];

  const uploadFloorPlan = async (index, file) => {
    if (!file) return;
    setFloorPlanUploading((p) => ({ ...p, [index]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/floor-plan", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      handleUnitTypeChange(index, "floorPlanImageUrl", data.url);
    } catch (err) {
      toast.error(err.message || "Floor plan upload failed.");
    } finally {
      setFloorPlanUploading((p) => ({ ...p, [index]: false }));
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

  // Per-unit lease-term multi-select (months a unit is offered for).
  const [customTermInput, setCustomTermInput] = useState({});
  const toggleUnitTerm = (index, months) => {
    setUnitTypes((prev) =>
      prev.map((u, i) => {
        if (i !== index) return u;
        const cur = Array.isArray(u.leaseTermMonths) ? u.leaseTermMonths : [];
        const next = cur.includes(months)
          ? cur.filter((m) => m !== months)
          : [...cur, months].sort((a, b) => a - b);
        return { ...u, leaseTermMonths: next };
      })
    );
  };
  const addCustomUnitTerm = (index) => {
    const n = Number(customTermInput[index]);
    if (!Number.isFinite(n) || n <= 0) return;
    setUnitTypes((prev) =>
      prev.map((u, i) => {
        if (i !== index) return u;
        const cur = Array.isArray(u.leaseTermMonths) ? u.leaseTermMonths : [];
        if (cur.includes(n)) return u;
        return { ...u, leaseTermMonths: [...cur, n].sort((a, b) => a - b) };
      })
    );
    setCustomTermInput((prev) => ({ ...prev, [index]: "" }));
  };

  // Reorder / remove staged (not-yet-uploaded) photos. DraggableImageGrid works on the
  // preview object-URLs; we mirror the change onto the underlying File array by index.
  const handleReorderStagedImages = (newUrls) => {
    setFormData((prev) => {
      const reordered = newUrls
        .map((u) => prev.images[imagePreviews.indexOf(u)])
        .filter(Boolean);
      return { ...prev, images: reordered };
    });
  };
  const handleRemoveStagedImage = (url) => {
    const idx = imagePreviews.indexOf(url);
    if (idx < 0) return;
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== idx),
    }));
  };

  // Auto Street View default photo (fetched once an address is selected). The user can delete
  // it; if kept, /api/addListing downloads + stores it server-side as the cover photo.
  const [streetView, setStreetView] = useState({ available: false, url: null });
  const [streetViewDeleted, setStreetViewDeleted] = useState(false);
  const [streetViewLoading, setStreetViewLoading] = useState(false);
  const showStreetView = streetView.available && !streetViewDeleted;

  const leaseStructureOptions = [
    { value: "individual", label: "Individual" },
    { value: "joint", label: "Joint" },
  ];


  const homeTypeOptions = [
    { value: "apartment", label: "Apartment" },
    { value: "house", label: "House" },
    { value: "studio", label: "Studio" },
    { value: "townhouse", label: "Townhouse" },
    { value: "single_room", label: "Single Room" },
    { value: "condo", label: "Condo" },
  ];

  // Values are exact `listing_amenities` boolean column names.
  const amenityOptions = [
    { value: "air_conditioning", label: "Air Conditioning" },
    { value: "dishwasher",       label: "Dishwasher" },
    { value: "gym",              label: "Gym" },
    { value: "laundry",          label: "Laundry" },
    { value: "mailroom",         label: "Mailroom" },
    { value: "microwave",        label: "Microwave" },
    { value: "oven",             label: "Oven" },
    { value: "parking",          label: "Parking" },
    { value: "pets_allowed",     label: "Pets Allowed" },
    { value: "pool",             label: "Pool" },
    { value: "refrigerator",     label: "Refrigerator" },
    { value: "rooftop",          label: "Rooftop" },
    { value: "storage",          label: "Storage" },
    { value: "stove",            label: "Stove" },
    { value: "study_room",       label: "Study Room" },
  ];

  const furnishedOptions = [
    { value: "furnished", label: "Furnished" },
    { value: "unfurnished", label: "Unfurnished" },
  ];

  // Address autocomplete state
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const addressTimeoutRef = useRef(null);
  const suggestionListRef = useRef(null);
  const fileInputRef = useRef(null);

  // Debounced address search using Mapbox Geocoding API
  const searchAddresses = useCallback(async (query) => {
    if (!query || query.length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          query
        )}.json?access_token=${
          process.env.NEXT_PUBLIC_MAPBOX_TOKEN
        }&types=address,poi&limit=5&proximity=-90.3053,38.6489`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch address suggestions");
      }

      const data = await response.json();
      setAddressSuggestions(data.features || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error("Address search error:", error);
      setAddressSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, []);

  const handleAddressChange = (e) => {
    const value = e.target.value;
    setFormData((prev) => ({ ...prev, address: value }));

    // Clear existing timeout
    if (addressTimeoutRef.current) {
      clearTimeout(addressTimeoutRef.current);
    }

    // Set new timeout for debounced search
    addressTimeoutRef.current = setTimeout(() => {
      searchAddresses(value);
    }, 300);
  };

  const handleAddressSelect = (suggestion) => {
    const [longitude, latitude] = suggestion.geometry.coordinates;
    const fullAddress = suggestion.place_name;

    setFormData((prev) => ({
      ...prev,
      address: fullAddress,
      longitude: longitude.toString(),
      latitude: latitude.toString(),
    }));

    setShowSuggestions(false);
    setAddressSuggestions([]);

    // Show success message
    toast.success("Address selected and coordinates auto-filled!");

    // Fetch a default Street View photo for the selected address.
    fetchStreetViewPreview(fullAddress, latitude, longitude);
  };

  // Ask the server whether Street View imagery exists for this address and, if so, get a
  // building-oriented preview image URL. Preview only — not persisted until submit.
  const fetchStreetViewPreview = async (address, latitude, longitude) => {
    setStreetViewDeleted(false);
    setStreetView({ available: false, url: null });
    setStreetViewLoading(true);
    try {
      const params = new URLSearchParams({
        address,
        lat: String(latitude),
        lng: String(longitude),
      });
      const res = await fetch(`/api/streetview/preview?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.available && data?.url) {
        setStreetView({ available: true, url: data.url });
      }
    } catch (err) {
      console.error("Street View preview error:", err);
    } finally {
      setStreetViewLoading(false);
    }
  };

  const mergeUniqueFiles = (currentFiles, nextFiles) => {
    const seen = new Set(
      currentFiles.map(
        (file) => `${file.name}-${file.size}-${file.lastModified}`
      )
    );
    const merged = [...currentFiles];

    nextFiles.forEach((file) => {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(file);
      }
    });

    return merged;
  };

  const handleImageFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      return;
    }

    const imageFiles = files.filter((file) => file.type?.startsWith("image/"));

    if (imageFiles.length !== files.length) {
      toast.error("Only image files are allowed");
    }

    setFormData((prev) => ({
      ...prev,
      images: mergeUniqueFiles(prev.images, imageFiles),
    }));
  };

  const handleImageChange = (e) => {
    handleImageFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleImageFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "images") {
      handleImageFiles(files);
    } else if (name === "address") {
      handleAddressChange(e);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: checked }));
  };

  const handleAmenityToggle = (amenity) => {
    setFormData((prev) => {
      const next = new Set(prev.amenities || []);
      if (next.has(amenity)) {
        next.delete(amenity);
      } else {
        next.add(amenity);
      }
      return { ...prev, amenities: Array.from(next) };
    });
  };

  const handleUnitTypeChange = (index, field, value) => {
    setUnitTypes((prev) =>
      prev.map((unit, unitIndex) =>
        unitIndex === index ? { ...unit, [field]: value } : unit
      )
    );
  };

  const handleAddUnitType = () => {
    setUnitTypes((prev) => [
      ...prev,
      { name: "", rent: "", area: "", bedrooms: "", bathrooms: "", available: true, floorPlanImageUrl: "", leaseTermMonths: [] },
    ]);
  };

  const handleRemoveUnitType = (index) => {
    setUnitTypes((prev) => prev.filter((_, unitIndex) => unitIndex !== index));
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        suggestionListRef.current &&
        !suggestionListRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (addressTimeoutRef.current) {
        clearTimeout(addressTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!formData.images || formData.images.length === 0) {
      setImagePreviews([]);
      return;
    }

    const previewUrls = formData.images.map((file) =>
      URL.createObjectURL(file)
    );
    setImagePreviews(previewUrls);

    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [formData.images]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isLoading) return;

    if (unitTypes.some((unit) => !unit.bedrooms || !unit.bathrooms)) {
      toast.error("All unit types require number of bedrooms and bathrooms.");
      return;
    }
    // An available unit must offer at least one lease term.
    if (
      unitTypes.some(
        (unit) =>
          unit.available !== false &&
          !(Array.isArray(unit.leaseTermMonths) && unit.leaseTermMonths.length > 0)
      )
    ) {
      toast.error(
        "Each available unit needs at least one lease term (or mark it unavailable)."
      );
      return;
    }

    setIsLoading(true);

    if (!formData.leaseStructure) {
      toast.error("Please select a lease structure.");
      setIsLoading(false);
      return;
    }

    // Coordinates are now automatically extracted from address selection
    if (!formData.longitude || !formData.latitude) {
      toast.error(
        "Please select an address from the dropdown to auto-fill coordinates"
      );
      setIsLoading(false);
      return;
    }

    try {
      const updatedFormData = {
        ...formData,
        unitTypes: unitTypes,
      };

      const dataToSend = {
        ...updatedFormData,
        unitTypes: unitTypes.map((unit) => ({
          name: unit.name,
          title: (unit.name ?? "").trim() || null,
          rent: unit.rent == "" ? undefined : Number(unit.rent),
          area: unit.area == "" ? undefined : Number(unit.area),
          bedrooms: Number(unit.bedrooms),
          bathrooms: Number(unit.bathrooms),
          available: unit.available !== false,
          floorPlanImageUrl: unit.floorPlanImageUrl || null,
          leaseTermMonths: Array.isArray(unit.leaseTermMonths)
            ? unit.leaseTermMonths.map(Number).filter((m) => Number.isFinite(m) && m > 0)
            : [],
        })),
        customAmenities,
        longitude: Number(formData.longitude),
        latitude: Number(formData.latitude),
        moveInDate: formData.moveInDate || undefined,
        amenities: formData.amenities || [],
        utilitiesIncluded: Array.isArray(formData.utilitiesIncluded) ? formData.utilitiesIncluded : [],
        subleaseFriendly: !!formData.subleaseFriendly,
        twenty_one_plus: !!formData.twentyOnePlus,
        images: [],
        attachStreetView: showStreetView,
      };

      const addResponse = await axios.post("/api/addListing", dataToSend);

      // Only upload images (if any) after listing is created,
      // because we need the listing ID for association
      if (formData.images.length > 0) {
        const listingId = addResponse?.data?.listing?.id;
        const MAX_BATCH_BYTES = 4 * 1024 * 1024; // stay under Vercel limit
        const batches = [];
        let currentBatch = [];
        let currentBytes = 0;

        for (const file of formData.images) {
          if (file.size > MAX_BATCH_BYTES) {
            toast.error("One of the images is too large to upload.");
            setIsLoading(false);
            return;
          }

          if (
            currentBytes + file.size > MAX_BATCH_BYTES &&
            currentBatch.length
          ) {
            batches.push(currentBatch);
            currentBatch = [];
            currentBytes = 0;
          }

          currentBatch.push(file);
          currentBytes += file.size;
        }

        if (currentBatch.length) {
          batches.push(currentBatch);
        }

        let uploadedImageUrls = [];
        for (const batch of batches) {
          const uploadData = new FormData();
          batch.forEach((file) => uploadData.append("files", file));
          uploadData.append("listingId", listingId);

          const uploadResponse = await axios.patch("/api/upload", uploadData);
          const batchUrls = uploadResponse.data?.urls || [];
          uploadedImageUrls = uploadedImageUrls.concat(batchUrls);
        }

        if (uploadedImageUrls.length === 0) {
          toast.error("Image upload failed");
          setIsLoading(false);
          return;
        }
      }

      toast.success("Listing Added!");

      setFormData({
        address: "",
        longitude: "",
        latitude: "",
        description: "",
        unitTypes: [],
        leaseStructure: "",
        leaseAvailability: [],
        moveInDate: "",
        homeType: "",
        amenities: [],
        furnished: "",
        utilitiesIncluded: [],
        subleaseFriendly: false,
        twentyOnePlus: false,
        images: [],
      });
      setStreetView({ available: false, url: null });
      setStreetViewDeleted(false);
      setUnitTypes([
        { name: "", rent: "", area: "", bedrooms: "", bathrooms: "", available: true, floorPlanImageUrl: "", leaseTermMonths: [] },
      ]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (e) {
      toast.error(e?.message);
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <main className="max-w-2xl mx-auto p-6 mt-10">
        <h1 className="text-3xl font-bold text-red-600 mb-6">Add a Listing</h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Address with Autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <div className="relative">
              <input
                type="text"
                name="address"
                required
                value={formData.address}
                onChange={handleChange}
                placeholder="Start typing an address..."
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                autoComplete="off"
              />

              {/* Loading indicator */}
              {isLoadingSuggestions && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin"></div>
                </div>
              )}
            </div>

            {/* Address suggestions dropdown */}
            {showSuggestions && addressSuggestions.length > 0 && (
              <div
                ref={suggestionListRef}
                className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto"
              >
                {addressSuggestions.map((suggestion, index) => (
                  <button
                    key={`${suggestion.id}-${index}`}
                    type="button"
                    onClick={() => handleAddressSelect(suggestion)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-start">
                      <div className="flex-shrink-0 mt-1">
                        <svg
                          className="w-4 h-4 text-gray-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {suggestion.text}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {suggestion.place_name}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Unit Types */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">
                Unit Types
              </label>
            </div>
            <div className="space-y-4">
              {unitTypes.map((unit, index) => (
                <div
                  key={`unit-${index}`}
                  className="rounded-md border border-gray-200 p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold text-gray-900">
                      Unit Type {index + 1}
                    </p>
                    {unitTypes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveUnitType(index)}
                        className="text-xs font-medium text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Unit Label (optional)
                      </label>
                      <input
                        type="text"
                        value={unit.name}
                        onChange={(e) =>
                          handleUnitTypeChange(index, "name", e.target.value)
                        }
                        placeholder="e.g. Studio, 2BR Deluxe"
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Rent ($)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={unit.rent}
                        onChange={(e) =>
                          handleUnitTypeChange(index, "rent", e.target.value)
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Area (sq ft)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={unit.area}
                        onChange={(e) =>
                          handleUnitTypeChange(index, "area", e.target.value)
                        }
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bedrooms
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={unit.bedrooms}
                        onChange={(e) =>
                          handleUnitTypeChange(
                            index,
                            "bedrooms",
                            e.target.value
                          )
                        }
                        required={index === 0}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bathrooms
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={unit.bathrooms}
                        onChange={(e) =>
                          handleUnitTypeChange(
                            index,
                            "bathrooms",
                            e.target.value
                          )
                        }
                        required={index === 0}
                        className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Lease Terms — select all this unit is offered for
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {leaseTermPresets.map((p) => {
                          const on = (unit.leaseTermMonths || []).includes(p.months);
                          return (
                            <button
                              key={p.label}
                              type="button"
                              onClick={() => toggleUnitTerm(index, p.months)}
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
                        {(unit.leaseTermMonths || [])
                          .filter(
                            (m) => !leaseTermPresets.some((p) => p.months === m)
                          )
                          .map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-red-600 text-white border-red-600"
                            >
                              {m}-Month
                              <button
                                type="button"
                                onClick={() => toggleUnitTerm(index, m)}
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
                          value={customTermInput[index] ?? ""}
                          onChange={(e) =>
                            setCustomTermInput((prev) => ({
                              ...prev,
                              [index]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomUnitTerm(index);
                            }
                          }}
                          placeholder="Custom #"
                          className="w-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                        <button
                          type="button"
                          onClick={() => addCustomUnitTerm(index)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Floor Plan Image / PDF (optional)
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadFloorPlan(index, f);
                            e.target.value = "";
                          }}
                          className="text-xs text-gray-600 file:mr-2 file:rounded-md file:border-0 file:bg-gray-200 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-gray-300"
                        />
                        {floorPlanUploading[index] && (
                          <span className="text-xs text-gray-500">Uploading…</span>
                        )}
                        {unit.floorPlanImageUrl && !floorPlanUploading[index] && (
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
                              onClick={() =>
                                handleUnitTypeChange(index, "floorPlanImageUrl", "")
                              }
                              className="text-xs text-gray-400 hover:text-red-600"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 select-none sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={unit.available !== false}
                        onChange={(e) =>
                          handleUnitTypeChange(
                            index,
                            "available",
                            e.target.checked
                          )
                        }
                        className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                      />
                      Available
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAddUnitType}
              className="mt-4 inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-red-400 hover:text-red-600 transition"
            >
              + Add another unit type
            </button>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              name="description"
              required
              value={formData.description}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              rows={5}
            />
          </div>

          {/* Lease Structure */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lease Structure
            </label>
            <select
              name="leaseStructure"
              value={formData.leaseStructure}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-100"
            >
              <option value="">--Select Lease Structure--</option>
              {leaseStructureOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Available From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Available From
            </label>
            <input
              type="date"
              name="leaseAvailability"
              value={formData.leaseAvailability}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Move-In Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Move-in Date
            </label>
            <input
              type="date"
              name="moveInDate"
              value={formData.moveInDate}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Home Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Home Type
            </label>
            <select
              name="homeType"
              value={formData.homeType}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-100"
            >
              <option value="">--Select Home Type--</option>
              {homeTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Furnished */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Furnished
            </label>
            <select
              name="furnished"
              value={formData.furnished}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-100"
            >
              <option value="">--Select Furnishing--</option>
              {furnishedOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Amenities */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amenities
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {amenityOptions.map((amenity) => (
                <label
                  key={amenity.value}
                  className="flex items-center gap-2 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={formData.amenities.includes(amenity.value)}
                    onChange={() => handleAmenityToggle(amenity.value)}
                    className="h-4 w-4"
                  />
                  {amenity.label}
                </label>
              ))}
            </div>
            {customAmenities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
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
            )}
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
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="button"
                onClick={addCustomAmenity}
                className="px-3 py-2 rounded-md text-sm font-medium bg-gray-200 text-gray-700 hover:bg-gray-300"
              >
                Add
              </button>
            </div>
          </div>

          {/* Utilities Included */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Utilities Included
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "electric", label: "Electric" },
                { value: "gas",      label: "Gas" },
                { value: "heat",     label: "Heat" },
                { value: "water",    label: "Water" },
                { value: "internet", label: "Internet" },
                { value: "trash",    label: "Trash" },
                { value: "cable",    label: "Cable" },
                { value: "sewer",    label: "Sewer" },
                { value: "cooling",  label: "Cooling" },
              ].map((utility) => (
                <label key={utility.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={formData.utilitiesIncluded.includes(utility.value)}
                    onChange={(e) => {
                      const current = formData.utilitiesIncluded || [];
                      setFormData({
                        ...formData,
                        utilitiesIncluded: e.target.checked
                          ? [...current, utility.value]
                          : current.filter((u) => u !== utility.value),
                      });
                    }}
                    className="h-4 w-4"
                  />
                  {utility.label}
                </label>
              ))}
            </div>
          </div>

          {/* Sublease Friendly */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                name="subleaseFriendly"
                checked={formData.subleaseFriendly}
                onChange={handleCheckboxChange}
                className="h-4 w-4"
              />
              Sublease Friendly
            </label>
          </div>

          {/* 21+ Only */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                name="twentyOnePlus"
                checked={formData.twentyOnePlus}
                onChange={handleCheckboxChange}
                className="h-4 w-4"
              />
              21+ Only
            </label>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Images
            </label>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              className="w-full border-2 border-dashed border-gray-300 rounded-md p-6 text-center cursor-pointer hover:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <input
                ref={fileInputRef}
                type="file"
                name="images"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageChange}
              />
              <p className="text-sm text-gray-600">
                Drag and drop images, or click to upload
              </p>
              <p className="text-xs text-gray-400 mt-1">PNG, JPG, WEBP</p>
            </div>

            {streetViewLoading && (
              <p className="mt-3 text-xs text-gray-500 flex items-center gap-1.5">
                <span className="w-3 h-3 border border-gray-300 border-t-red-500 rounded-full animate-spin" />
                Looking for a Street View photo…
              </p>
            )}

            {(showStreetView || imagePreviews.length > 0) && (
              <div className="mt-3 space-y-3">
                {showStreetView && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="relative aspect-square overflow-hidden rounded-md border border-gray-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={streetView.url}
                        alt="Street View of the property"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/60 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.94 6.31a1.5 1.5 0 112.12 2.12L9.7 9.79a1 1 0 00-.29.7V11a1 1 0 11-2 0v-.5a3 3 0 01.88-2.12l.65-.65zM10 14.5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        </svg>
                        Street View
                      </div>
                      <button
                        type="button"
                        onClick={() => setStreetViewDeleted(true)}
                        aria-label="Remove Street View photo"
                        className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center hover:bg-black/80 transition"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}
                {imagePreviews.length > 0 && (
                  <DraggableImageGrid
                    images={imagePreviews}
                    onReorder={handleReorderStagedImages}
                    onRemove={handleRemoveStagedImage}
                  />
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-md font-medium transition"
          >
            {isLoading && (
              <div className="flex items-center justify-center">
                <div className="w-6 h-6 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
            )}
            Submit Listing
          </button>
        </form>
      </main>
    </>
  );
}
