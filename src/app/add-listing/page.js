"use client";

import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import FieldStateBadge from "./_components/FieldStateBadge";
import ListingModalInfo from "@/components/listings/ListingModalInfo";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";
import { fetchAllWalkTimes } from "@/utils/walkTimes";

// ─── Constants ────────────────────────────────────────────────────────────────

const AMENITY_COLS = [
  "air_conditioning","dishwasher","gym","laundry","mailroom","microwave",
  "oven","parking","pets_allowed","pool","refrigerator","rooftop",
  "storage","stove","study_room",
];
const AMENITY_LABELS = {
  air_conditioning:"Air conditioning", dishwasher:"Dishwasher", gym:"Gym",
  laundry:"Laundry", mailroom:"Mailroom", microwave:"Microwave", oven:"Oven",
  parking:"Parking", pets_allowed:"Pets allowed", pool:"Pool",
  refrigerator:"Refrigerator", rooftop:"Rooftop", storage:"Storage",
  stove:"Stove", study_room:"Study room",
};
const UTILITY_COLS = ["electric","gas","heat","water","internet","trash","cable","sewer","cooling"];
const UTILITY_LABELS = {
  electric:"Electric", gas:"Gas", heat:"Heat", water:"Water",
  internet:"Internet", trash:"Trash", cable:"Cable", sewer:"Sewer", cooling:"Cooling",
};
const HOME_TYPES = ["Apartment","House","Studio","Townhouse","Single Room","Condo","Other"];
const MAX_BATCH = 4 * 1024 * 1024;

// ─── State (no amenities/utilities — those come from DB) ──────────────────────

const INITIAL = {
  phase: "upload", // "upload" | "analysing" | "editing"
  listingId: null,
  templateId: null,
  imageUrls: [],
  fieldStates: {},
  address: "", longitude: null, latitude: null,
  title: "", description: "", homeType: "", leaseStructure: "",
  contactName: "", contactEmail: "", contactPhone: "",
  subleaseFriendly: false, twentyOnePlus: false, furnished: false,
  petPolicy: "",
  leases: [],
  fees: [],
  analysisLog: [],
  analysisError: null,
  zillowData: null,
  infoConfirmed: false,
  progress: 0,
  currentStep: "",
  placeWalkMinutes: {},
  shuttleWalkMinutes: null,
};

function reducer(s, a) {
  switch (a.type) {
    case "SET": return { ...s, ...a.payload };
    case "LOG": return { ...s, analysisLog: [...s.analysisLog, a.msg] };
    case "SET_LEASE": return { ...s, leases: s.leases.map((l, i) => i === a.idx ? { ...l, ...a.data } : l) };
    case "ADD_LEASE": return { ...s, leases: [...s.leases, a.lease] };
    case "REMOVE_LEASE": return { ...s, leases: s.leases.filter((_, i) => i !== a.idx) };
    case "RESET": return { ...INITIAL };
    default: return s;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inp(cls = "") {
  return `w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 ${cls}`;
}
function Label({ children, required }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}
function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );
}

// ─── Address autocomplete ─────────────────────────────────────────────────────

function AddressInput({ value, hasCoords, onChange, onSelect, disabled }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  const search = useCallback(async (q) => {
    if (q.length < 3) { setSuggestions([]); return; }
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&types=address&limit=5&proximity=-90.3053,38.6489`
    );
    const d = await res.json();
    setSuggestions(d.features || []);
    setOpen(true);
  }, []);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <input
        type="text" value={value} disabled={disabled} autoComplete="off"
        onChange={e => {
          onChange(e.target.value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => search(e.target.value), 300);
        }}
        placeholder="Start typing an address…"
        className={inp(disabled ? "bg-gray-50" : "")}
      />
      {hasCoords && <p className="text-xs text-green-600 mt-1">✓ Location confirmed</p>}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
          {suggestions.map(s => (
            <li key={s.id}>
              <button type="button"
                onClick={() => { onSelect(s); setOpen(false); setSuggestions([]); }}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <p className="font-medium text-gray-900">{s.text}</p>
                <p className="text-xs text-gray-500">{s.place_name}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ accept, multiple, label, sublabel, icon, files, onFiles, disabled }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef(null);
  return (
    <div
      onClick={() => !disabled && ref.current?.click()}
      onDrop={e => { e.preventDefault(); setDrag(false); if (!disabled) onFiles(e.dataTransfer.files); }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition
        ${disabled ? "opacity-60 cursor-default"
        : drag ? "border-red-400 bg-red-50"
        : files.length ? "border-green-400 bg-green-50"
        : "border-gray-300 hover:border-red-300 hover:bg-gray-50"}`}
    >
      <input ref={ref} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={e => onFiles(e.target.files)} />
      <div className="text-2xl mb-1">{icon}</div>
      {files.length > 0 ? (
        <p className="text-sm font-medium text-green-700">
          {files.length > 1 ? `${files.length} files selected` : files[0]?.name}
        </p>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-700">{label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AddListing() {
  const [s, dispatch] = useReducer(reducer, INITIAL);
  const { data: session } = useSession();
  const router = useRouter();

  // Amenities & utilities — fetched from DB, updated via PATCH
  const [amenities, setAmenities] = useState({});
  const [utilities, setUtilities] = useState({});
  const [savingAmenities, setSavingAmenities] = useState(false);

  // Files (not in reducer — File objects can't serialize)
  const [pdfFile, setPdfFile] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  const log = (msg) => dispatch({ type: "LOG", msg });
  const set = (payload) => dispatch({ type: "SET", payload });
  const step = (msg, pct) => set({ currentStep: msg, progress: pct });

  // Pre-fill contact info from landlord profile
  useEffect(() => {
    if (!session?.user?.email) return;
    fetch("/api/getUser").then(r => r.ok ? r.json() : null).then(user => {
      if (!user) return;
      set({ contactName: user.name || "", contactEmail: user.email || "", contactPhone: user.phone || "" });
    });
  }, [session?.user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch amenities/utilities from DB whenever listingId is set (stays in sync with DB)
  const refreshAmenities = useCallback(async () => {
    if (!s.listingId) return;
    const res = await fetch(`/api/listing/${s.listingId}`);
    if (!res.ok) return;
    const listing = await res.json();
    const aObj = Object.fromEntries(AMENITY_COLS.map(c => [c, (listing.amenities || []).includes(c)]));
    const uObj = Object.fromEntries(UTILITY_COLS.map(c => [c, (listing.utilitiesIncluded || []).includes(c)]));
    setAmenities(aObj);
    setUtilities(uObj);
  }, [s.listingId]);

  useEffect(() => { refreshAmenities(); }, [refreshAmenities]);

  // Save amenities/utilities to DB immediately on toggle
  const saveAmenities = useCallback(async (nextAmenities, nextUtilities) => {
    if (!s.listingId || savingAmenities) return;
    setSavingAmenities(true);
    await fetch(`/api/landlord/listings/${s.listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amenities: AMENITY_COLS.filter(c => nextAmenities[c]),
        utilities_included: UTILITY_COLS.filter(c => nextUtilities[c]),
      }),
    });
    setSavingAmenities(false);
  }, [s.listingId, savingAmenities]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAmenity = (key) => {
    const next = { ...amenities, [key]: !amenities[key] };
    setAmenities(next);
    saveAmenities(next, utilities);
  };

  const toggleUtility = (key) => {
    const next = { ...utilities, [key]: !utilities[key] };
    setUtilities(next);
    saveAmenities(amenities, next);
  };

  // Orphaned drafts (unavailable: true) are invisible to students.
  // The "Discard draft" button handles explicit cleanup.
  // No beforeunload handler — sendBeacon only sends POST, not DELETE.

  const handleImageFiles = (fileList) => {
    const imgs = Array.from(fileList).filter(f => f.type.startsWith("image/"));
    setImageFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}-${f.size}`));
      const merged = [...prev, ...imgs.filter(f => !seen.has(`${f.name}-${f.size}`))];
      setImagePreviews(merged.map(f => URL.createObjectURL(f)));
      return merged;
    });
  };

  // ─── Analysis ────────────────────────────────────────────────────────────────

  const analyse = async () => {
    if (!s.address || !s.longitude) {
      toast.error("Please select an address from the dropdown first");
      return;
    }
    if (!pdfFile && imageFiles.length === 0) {
      toast.error("Upload a lease PDF or photos to analyse");
      return;
    }
    set({ phase: "analysing", analysisError: null, analysisLog: [], progress: 5, currentStep: "Creating listing draft…" });

    let listingId = null;
    let templateId = null;

    try {
      // 1. Create listing draft
      const draftRes = await fetch("/api/landlord/listings/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: s.address, longitude: s.longitude, latitude: s.latitude,
          description: ".", contactName: s.contactName,
          contactEmail: s.contactEmail, contactPhone: s.contactPhone,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || "Failed to create listing");
      listingId = draftData.listingId;
      set({ listingId });

      step("", 15);

      // 2. Zillow lookup — runs in background, fills empty fields only
      fetch("/api/landlord/zillow-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: s.address, latitude: s.latitude, longitude: s.longitude }),
      }).then(r => r.ok ? r.json() : null).then(zd => {
        if (!zd?.found) return;
        set(prev => {
          const updates = { zillowData: zd };
          if (!prev.title       && zd.title)     updates.title     = zd.title;
          if (!prev.description && zd.description) updates.description = zd.description;
          if (!prev.homeType    && zd.home_type) updates.homeType  = zd.home_type;
          if (prev.furnished === false && zd.furnished) updates.furnished = zd.furnished;
          if (!prev.contactPhone && zd.contact_phone) updates.contactPhone = zd.contact_phone;
          return updates;
        });
        // Pre-fill one lease row from Zillow if none exist yet
        if (s.leases.length === 0 && (zd.bedrooms || zd.rent)) {
          dispatch({ type: "ADD_LEASE", lease: {
            bedrooms: zd.bedrooms ?? "", bathrooms: zd.bathrooms ?? "",
            area: zd.area_sqft ?? "", rent: zd.rent ?? "",
            pricing_basis: "per_unit", lease_term_months: "12",
            available_from: "", sublease: false,
            total_bedrooms: null, total_bathrooms: null,
          }});
        }
      }).catch(() => {});

      // 3. Upload + extract PDF (single upload → single template)
      if (pdfFile) {
        step("", 30);
        const fd = new FormData();
        fd.append("file", pdfFile);
        const uploadRes = await fetch("/api/landlord/pdf-upload", { method: "POST", body: fd });
        const { url, error: uploadErr } = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadErr || "PDF upload failed");

        const tplRes = await fetch("/api/landlord/lease-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: pdfFile.name.replace(/\.pdf$/i, ""),
            template_pdf_url: url,
            listing_id: listingId,
          }),
        });
        const tplData = await tplRes.json();
        if (!tplRes.ok) throw new Error(tplData.error || "Failed to save template");
        templateId = tplData.id;
        set({ templateId });

        step("", 55);
        const exRes = await fetch(`/api/landlord/lease-templates/${templateId}/extract`, { method: "POST" });
        await exRes.json();
      }

      // 4. Upload images + AI amenity detection
      if (imageFiles.length > 0) {
        step("", 70);
        const batches = [];
        let batch = [], bytes = 0;
        for (const f of imageFiles) {
          if (bytes + f.size > MAX_BATCH && batch.length) { batches.push(batch); batch = []; bytes = 0; }
          batch.push(f); bytes += f.size;
        }
        if (batch.length) batches.push(batch);

        const allUrls = [];
        for (const b of batches) {
          const fd = new FormData();
          b.forEach(f => fd.append("files", f));
          fd.append("listingId", listingId);
          const res = await fetch("/api/upload", { method: "PATCH", body: fd });
          const data = await res.json();
          if (res.ok) allUrls.push(...(data.urls || []));
        }
        if (allUrls.length > 0) {
          set({ imageUrls: allUrls });
          step("", 80);
          await fetch("/api/landlord/extract-from-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listing_id: listingId, image_urls: allUrls }),
          });
        }
      }

      // 5. Fetch all extracted state from DB
      step("", 90);
      const [fsRes, ppRes, feesRes, leasesRes, tplDetailRes] = await Promise.all([
        fetch(`/api/landlord/listings/${listingId}/field-states`),
        fetch(`/api/landlord/listings/${listingId}/pet-policy`),
        fetch(`/api/landlord/listings/${listingId}/fees`),
        fetch(`/api/landlord/leases?listing_id=${listingId}`),
        templateId ? fetch(`/api/landlord/lease-templates/${templateId}`) : Promise.resolve(null),
      ]);

      // Field states (for badges)
      const fieldStates = {};
      if (fsRes.ok) {
        for (const r of await fsRes.json()) fieldStates[`${r.table_name}.${r.field_name}`] = r;
      }

      // Pet policy
      const petPolicy = ppRes.ok ? ((await ppRes.json()).policy_text || "") : "";

      // Fees
      const fees = feesRes.ok ? await feesRes.json() : [];

      // Lease rows — from DB first, fall back to template extraction
      let dbLeases = leasesRes.ok ? (await leasesRes.json()).filter(l => l.is_active && !l.deleted_at) : [];
      let tplExtracted = null;
      if (tplDetailRes?.ok) tplExtracted = (await tplDetailRes.json()).extracted_fields;

      if (dbLeases.length === 0 && tplExtracted?.base_rent_options?.length > 0) {
        dbLeases = tplExtracted.base_rent_options.map(opt => ({
          id: null,
          bedrooms: tplExtracted.bedrooms ?? 1,
          bathrooms: tplExtracted.bathrooms ?? 1,
          area: tplExtracted.area_sqft ?? null,
          pricing_basis: opt.basis === "per_bed" ? "per_bed" : "per_unit",
          rent: opt.rent,
          lease_term_months: opt.months,
          available_from: "",
          sublease: false,
          total_bedrooms: null,
          total_bathrooms: null,
        }));
      }

      // Compute walk times client-side so the preview map/places tabs are accurate
      const walkTimes = await fetchAllWalkTimes(s.latitude, s.longitude).catch(() => null);

      set({
        phase: "editing",
        fieldStates,
        petPolicy,
        fees,
        leases: dbLeases,
        title: fieldStates["listings.title"]?.suggested_value || "",
        description: fieldStates["listings.description"]?.suggested_value || "",
        placeWalkMinutes: walkTimes?.placeWalkMinutes ?? {},
        shuttleWalkMinutes: walkTimes?.shuttleWalkMinutes ?? null,
        progress: 100,
        currentStep: "",
      });

    } catch (err) {
      console.error("[analyse]", err);
      set({ phase: s.listingId ? "editing" : "upload", analysisError: err.message });
      toast.error(err.message);
    }
  };

  // ─── Publish ──────────────────────────────────────────────────────────────

  const publish = async () => {
    if (!s.listingId) return;
    setPublishing(true);
    try {
      await fetch(`/api/landlord/listings/${s.listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: s.title || null,
          description: s.description,
          home_type: s.homeType || null,
          lease_structure: s.leaseStructure || null,
          contact_name: s.contactName || null,
          contact_email: s.contactEmail || null,
          contact_phone: s.contactPhone || null,
          sublease_friendly: s.subleaseFriendly,
          twenty_one_plus: s.twentyOnePlus,
          furnished: s.furnished,
          unavailable: false,
        }),
      });

      if (s.petPolicy) {
        await fetch(`/api/landlord/listings/${s.listingId}/pet-policy`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy_text: s.petPolicy }),
        });
      }

      for (const lease of s.leases) {
        if (!lease.bedrooms || !lease.rent) continue;
        const body = {
          listing_id: s.listingId,
          bedrooms: Number(lease.bedrooms),
          bathrooms: Number(lease.bathrooms),
          area: lease.area ? Number(lease.area) : null,
          pricing_basis: lease.pricing_basis || "per_unit",
          rent: Number(lease.rent),
          lease_term_months: Number(lease.lease_term_months) || 12,
          available_from: lease.available_from || null,
          sublease: lease.sublease || false,
          total_bedrooms: lease.total_bedrooms ? Number(lease.total_bedrooms) : null,
          total_bathrooms: lease.total_bathrooms ? Number(lease.total_bathrooms) : null,
        };
        if (lease.id) {
          await fetch(`/api/landlord/leases/${lease.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } else {
          await fetch("/api/landlord/leases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        }
      }

      toast.success("Listing published!");
      const role = session?.user?.role;
      router.push(role === "student" ? "/dashboard/student" : "/dashboard/landlord?tab=properties");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const reorderImages = async (newUrls) => {
    set({ imageUrls: newUrls });
    if (!s.listingId) return;
    setSavingOrder(true);
    await fetch(`/api/landlord/listings/${s.listingId}/images`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: newUrls }),
    });
    setSavingOrder(false);
  };

  const removeImage = async (url) => {
    const next = s.imageUrls.filter((u) => u !== url);
    set({ imageUrls: next });
    if (!s.listingId) return;
    await fetch(`/api/landlord/listings/${s.listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: next }),
    });
  };

  const discard = async () => {
    if (!confirm("Discard this listing draft? This cannot be undone.")) return;
    if (s.listingId) {
      await fetch(`/api/landlord/listings/${s.listingId}`, { method: "DELETE" });
    }
    dispatch({ type: "RESET" });
    setPdfFile(null);
    setImageFiles([]);
    setImagePreviews([]);
    setAmenities({});
    setUtilities({});
  };

  // ─── Synthetic listing for student preview (reads from current state + DB amenities) ──

  const previewListing = {
    _id: s.listingId,
    id: s.listingId,
    address: s.address,
    title: s.title || s.address,
    description: s.description,
    images: s.imageUrls,
    unitTypes: s.leases.filter(l => l.bedrooms && l.rent).map(l => ({
      bedrooms: Number(l.bedrooms),
      bathrooms: Number(l.bathrooms),
      area: l.area ? Number(l.area) : null,
      rent: Number(l.rent),
      pricingBasis: l.pricing_basis,
      leaseTermMonths: Number(l.lease_term_months),
    })),
    amenities: AMENITY_COLS.filter(c => amenities[c]),
    utilitiesIncluded: UTILITY_COLS.filter(c => utilities[c]),
    homeType: s.homeType || "Other",
    leaseType: s.leases.some(l => l.sublease) ? "Sublease" : "Standard",
    leaseStructure: s.leaseStructure || null,
    contactName: s.contactName,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    subleaseFriendly: s.subleaseFriendly,
    twentyOnePlus: s.twentyOnePlus,
    furnished: s.furnished,
    leaseAvailability: [],
    placeWalkMinutes: s.placeWalkMinutes,
    shuttleWalkMinutes: s.shuttleWalkMinutes,
    reviews: [],
    numReviews: 0,
    rating: 0,
  };

  const fs = (table, field) => s.fieldStates[`${table}.${field}`]?.state || "empty";

  // ─── Upload phase ─────────────────────────────────────────────────────────

  if (s.phase === "upload" || s.phase === "analysing") {
    const busy = s.phase === "analysing";
    return (
      <main className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Add a listing</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enter the address, drop your lease PDF and photos — AI fills in the details automatically.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <Label required>Property address</Label>
            <AddressInput
              value={s.address} hasCoords={!!s.longitude} disabled={busy}
              onChange={v => set({ address: v, longitude: null, latitude: null })}
              onSelect={sug => {
                const [lng, lat] = sug.geometry.coordinates;
                set({ address: sug.place_name, longitude: lng, latitude: lat });
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Lease PDF</Label>
              <UploadZone accept="application/pdf" multiple={false} icon="📑"
                label="Drop lease PDF here" sublabel="Up to 20 MB"
                files={pdfFile ? [pdfFile] : []} disabled={busy}
                onFiles={fl => {
                  const f = fl[0];
                  if (f?.type?.includes("pdf")) setPdfFile(f);
                  else toast.error("PDF files only");
                }} />
            </div>
            <div>
              <Label>Photos</Label>
              <UploadZone accept="image/*" multiple icon="🖼️"
                label="Drop photos here" sublabel="PNG, JPG, WEBP"
                files={imageFiles} disabled={busy}
                onFiles={handleImageFiles} />
            </div>
          </div>

          {imagePreviews.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {imagePreviews.slice(0, 8).map((src, i) => (
                <div key={i} className="aspect-square rounded-lg overflow-hidden border border-gray-200">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          )}

          {busy && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                  Analysing…
                </span>
                <span className="font-medium tabular-nums">{s.progress}%</span>
              </div>
              <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full transition-all duration-500"
                  style={{ width: `${s.progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={analyse}
            disabled={busy || !s.longitude || (!pdfFile && imageFiles.length === 0)}
            className="w-full py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition flex items-center justify-center gap-2 text-sm"
          >
            {busy
              ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Working…</>
              : "Analyse with AI →"}
          </button>
        </div>
      </main>
    );
  }

  // ─── Editing phase ────────────────────────────────────────────────────────

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Review & publish</h1>
          <p className="text-sm text-gray-500 mt-0.5">Confirm the AI-extracted details, then publish.</p>
        </div>
        <button onClick={discard} className="text-xs text-gray-400 hover:text-red-600 transition">
          Discard draft
        </button>
      </div>

      {s.analysisError && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
          ⚠ Some extraction failed: {s.analysisError}. Fill in remaining fields manually.
        </div>
      )}

      {/* Property */}
      <Section title="Property">
        <div className="space-y-4">
          <div>
            <Label required>Address</Label>
            <AddressInput
              value={s.address} hasCoords={!!s.longitude}
              onChange={v => set({ address: v, longitude: null, latitude: null })}
              onSelect={sug => {
                const [lng, lat] = sug.geometry.coordinates;
                set({ address: sug.place_name, longitude: lng, latitude: lat });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Title</Label>
                {fs("listings","title") !== "empty" && <FieldStateBadge state={fs("listings","title")} compact />}
              </div>
              <input type="text" value={s.title} onChange={e => set({ title: e.target.value })}
                placeholder="e.g. Sunny 2BR near campus" className={inp()} />
            </div>
            <div>
              <Label>Home type</Label>
              <select value={s.homeType} onChange={e => set({ homeType: e.target.value })} className={inp("bg-white")}>
                <option value="">Select…</option>
                {HOME_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Description</Label>
              {fs("listings","description") !== "empty" && <FieldStateBadge state={fs("listings","description")} compact />}
            </div>
            <textarea value={s.description} onChange={e => set({ description: e.target.value })}
              rows={4} className={inp()} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Lease structure</Label>
              <select value={s.leaseStructure} onChange={e => set({ leaseStructure: e.target.value })} className={inp("bg-white")}>
                <option value="">Select…</option>
                <option value="individual">Individual</option>
                <option value="joint">Joint</option>
              </select>
            </div>
            <div className="flex items-end gap-4 pb-1">
              {[["subleaseFriendly","Sublease OK"],["twentyOnePlus","21+"],["furnished","Furnished"]].map(([k,label]) => (
                <label key={k} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={!!s[k]} onChange={e => set({ [k]: e.target.checked })} className="h-4 w-4 rounded" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* Contact */}
      <Section title="Contact info">
        <div className="grid grid-cols-3 gap-4">
          {[["contactName","Name"],["contactEmail","Email"],["contactPhone","Phone"]].map(([k,label]) => (
            <div key={k}>
              <Label>{label}</Label>
              <input type="text" value={s[k]} onChange={e => set({ [k]: e.target.value })} className={inp()} />
            </div>
          ))}
        </div>
      </Section>

      {/* Amenities — from DB, saved immediately on toggle */}
      <Section title="Amenities & utilities">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Amenities</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
          {AMENITY_COLS.map(c => {
            const aiSuggested = s.fieldStates[`listing_amenities.${c}`]?.state === "ai_suggested";
            return (
              <label key={c}
                className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm cursor-pointer transition
                  ${amenities[c] ? "bg-green-50 border-green-200 text-green-800" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
                <span>{AMENITY_LABELS[c]}</span>
                <div className="flex items-center gap-1.5">
                  {aiSuggested && <span className="text-xs bg-yellow-100 text-yellow-600 px-1 rounded">AI</span>}
                  <input type="checkbox" checked={!!amenities[c]} onChange={() => toggleAmenity(c)} className="h-4 w-4 rounded" />
                </div>
              </label>
            );
          })}
        </div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Utilities included</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {UTILITY_COLS.map(c => (
            <label key={c}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm cursor-pointer transition
                ${utilities[c] ? "bg-green-50 border-green-200 text-green-800" : "bg-gray-50 border-gray-200 text-gray-500"}`}>
              <span>{UTILITY_LABELS[c]}</span>
              <input type="checkbox" checked={!!utilities[c]} onChange={() => toggleUtility(c)} className="h-4 w-4 rounded" />
            </label>
          ))}
        </div>
      </Section>

      {/* Pet policy */}
      <Section title="Pet policy">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-500">Extracted from lease PDF if available.</p>
          {fs("listing_pet_policies","policy_text") !== "empty" && <FieldStateBadge state={fs("listing_pet_policies","policy_text")} compact />}
        </div>
        <textarea value={s.petPolicy} onChange={e => set({ petPolicy: e.target.value })} rows={3}
          placeholder="e.g. Small dogs and cats allowed with $300 pet deposit."
          className={inp()} />
      </Section>

      {/* Lease offers */}
      <Section title="Lease offers">
        <p className="text-xs text-gray-500 mb-3">Pre-filled from lease PDF. Edit or add rows as needed.</p>
        <div className="space-y-3">
          {s.leases.map((lease, i) => (
            <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[["bedrooms","Bedrooms"],["bathrooms","Bathrooms"],["rent","Rent ($)"],["lease_term_months","Term (mo)"]].map(([k,label]) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input type="number" inputMode="decimal" value={lease[k] || ""}
                      onChange={e => dispatch({ type: "SET_LEASE", idx: i, data: { [k]: e.target.value } })}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Pricing</label>
                  <select value={lease.pricing_basis || "per_unit"}
                    onChange={e => dispatch({ type: "SET_LEASE", idx: i, data: { pricing_basis: e.target.value } })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm bg-white">
                    <option value="per_unit">Per unit / mo</option>
                    <option value="per_bed">Per bed / mo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Area (sq ft)</label>
                  <input type="number" value={lease.area || ""}
                    onChange={e => dispatch({ type: "SET_LEASE", idx: i, data: { area: e.target.value } })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Available from</label>
                  <input type="date" value={lease.available_from || ""}
                    onChange={e => dispatch({ type: "SET_LEASE", idx: i, data: { available_from: e.target.value } })}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
                </div>
              </div>

              {/* Lease type toggle */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lease type</label>
                <div className="flex gap-2">
                  {[["Standard", false],["Sublease", true]].map(([label, val]) => (
                    <button key={label} type="button"
                      onClick={() => dispatch({ type: "SET_LEASE", idx: i, data: { sublease: val, total_bedrooms: val ? lease.total_bedrooms : null, total_bathrooms: val ? lease.total_bathrooms : null } })}
                      className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition ${
                        lease.sublease === val
                          ? val ? "bg-blue-600 text-white border-blue-600" : "bg-gray-800 text-white border-gray-800"
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sublease total unit size */}
              {lease.sublease && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-blue-800">Full physical unit size (not what&apos;s being subleased)</p>
                  <div className="grid grid-cols-2 gap-3">
                    {[["total_bedrooms","Total bedrooms"],["total_bathrooms","Total bathrooms"]].map(([k,label]) => (
                      <div key={k}>
                        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                        <input type="number" value={lease[k] || ""}
                          onChange={e => dispatch({ type: "SET_LEASE", idx: i, data: { [k]: e.target.value } })}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button onClick={() => dispatch({ type: "REMOVE_LEASE", idx: i })}
                  className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => dispatch({ type: "ADD_LEASE", lease: { bedrooms:"",bathrooms:"",area:"",pricing_basis:"per_unit",rent:"",lease_term_months:"12",available_from:"",sublease:false,total_bedrooms:null,total_bathrooms:null } })}
          className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-red-400 hover:text-red-600 transition">
          + Add lease offer
        </button>
      </Section>

      {/* Photos */}
      <Section title="Photos">
        {s.imageUrls.length > 0 && (
          <div className="mb-4">
            <DraggableImageGrid
              images={s.imageUrls}
              onReorder={reorderImages}
              onRemove={removeImage}
              saving={savingOrder}
            />
          </div>
        )}
        <UploadZone accept="image/*" multiple icon="🖼️"
          label="Add more photos" sublabel="PNG, JPG, WEBP"
          files={[]} disabled={false}
          onFiles={async (fileList) => {
            const imgs = Array.from(fileList).filter(f => f.type.startsWith("image/"));
            if (!imgs.length || !s.listingId) return;
            const batches = [];
            let batch = [], bytes = 0;
            for (const f of imgs) {
              if (bytes + f.size > MAX_BATCH && batch.length) { batches.push(batch); batch = []; bytes = 0; }
              batch.push(f); bytes += f.size;
            }
            if (batch.length) batches.push(batch);
            const allUrls = [];
            for (const b of batches) {
              const fd = new FormData();
              b.forEach(f => fd.append("files", f));
              fd.append("listingId", s.listingId);
              const res = await fetch("/api/upload", { method: "PATCH", body: fd });
              const data = await res.json();
              if (res.ok) allUrls.push(...(data.urls || []));
            }
            if (allUrls.length) set({ imageUrls: [...s.imageUrls, ...allUrls] });
          }}
        />
      </Section>

      {/* Student preview */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Student preview</h2>
        <p className="text-xs text-gray-500 mb-2">Exactly how students will see your listing. Updates as you edit.</p>
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          Map and walk times are approximate during preview — exact distances will finalize once the listing is published.
        </p>
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
          <ListingModalInfo
            listing={previewListing}
            session={session}
            excludeTabs={["contact","reviews"]}
            compact
          />
        </div>
      </div>

      {/* Publish bar */}
      <div className="pt-4 border-t border-gray-200 pb-8 space-y-4">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={s.infoConfirmed}
            onChange={e => set({ infoConfirmed: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span className="text-sm text-gray-600">
            I confirm that the information provided in this listing is accurate and complete to the best of my knowledge, and that I am authorized to list this property for rent.
          </span>
        </label>

        <div className="flex items-center justify-between">
          <button onClick={discard} className="text-sm text-gray-500 hover:text-red-600 transition">
            Discard draft
          </button>
          <div className="flex gap-3">
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => router.push(session?.user?.role === "student" ? "/dashboard/student" : "/dashboard/landlord?tab=properties")}
                className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition">
                Save as draft
              </button>
              <span className="text-xs text-gray-400">Switch to available in dashboard to publish</span>
            </div>
            <button
              onClick={publish}
              disabled={publishing || s.leases.length === 0 || !s.infoConfirmed}
              className="px-8 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition">
              {publishing ? "Publishing…" : "Publish listing"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
