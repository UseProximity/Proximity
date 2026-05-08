"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

const TABS = [
  { id: "basics",      label: "Basics" },
  { id: "amenities",   label: "Amenities & utilities" },
  { id: "pet-policy",  label: "Pet policy" },
  { id: "fees",        label: "Fees" },
  { id: "concessions", label: "Concessions" },
  { id: "photos",      label: "Photos" },
  { id: "faqs",        label: "FAQs" },
  { id: "verify",      label: "Verification" },
];

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

function SaveBar({ saving, onSave }) {
  return (
    <div className="flex justify-end pt-4 border-t border-gray-100 mt-6">
      <button onClick={onSave} disabled={saving}
        className="px-6 py-2 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-50 transition">
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

// ── Basics tab ─────────────────────────────────────────────────────────────────
function BasicsTab({ listing, onSave }) {
  const [form, setForm] = useState({
    title: listing.title || "",
    description: listing.description || "",
    homeType: listing.homeType || "",
    leaseStructure: listing.leaseStructure || "",
    contact_name: listing.contactName || "",
    contact_email: listing.contactEmail || "",
    contact_phone: listing.contactPhone || "",
    sublease_friendly: listing.subleaseFriendly || false,
    twenty_one_plus: listing.twentyOnePlus || false,
    furnished: listing.furnished || false,
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        title: form.title || null,
        description: form.description,
        home_type: form.homeType,
        lease_structure: form.leaseStructure || null,
        contact_name: form.contact_name || null,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        sublease_friendly: form.sublease_friendly,
        twenty_one_plus: form.twenty_one_plus,
        furnished: form.furnished,
      });
      toast.success("Saved");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {[["title","Title"],["description","Description",true],["contact_name","Contact name"],["contact_email","Contact email"],["contact_phone","Contact phone"]].map(([k, label, multi]) => (
        <div key={k}>
          <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
          {multi ? (
            <textarea value={form[k]} onChange={set(k)} rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          ) : (
            <input type="text" value={form[k]} onChange={set(k)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Home type</label>
          <select value={form.homeType} onChange={set("homeType")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
            <option value="">Select…</option>
            {HOME_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lease structure</label>
          <select value={form.leaseStructure} onChange={set("leaseStructure")}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500">
            <option value="">Select…</option>
            <option value="individual">Individual</option>
            <option value="joint">Joint</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        {[["sublease_friendly","Sublease friendly"],["twenty_one_plus","21+ only"],["furnished","Furnished"]].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form[k]} onChange={set(k)} className="h-4 w-4 rounded" />
            {label}
          </label>
        ))}
      </div>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

// ── Amenities & utilities tab ──────────────────────────────────────────────────
function AmenitiesTab({ listingId, listing }) {
  const [amenities, setAmenities] = useState({});
  const [utilities, setUtilities] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAmenities(Object.fromEntries(AMENITY_COLS.map((c) => [c, (listing.amenities || []).includes(c)])));
    setUtilities(Object.fromEntries(UTILITY_COLS.map((c) => [c, (listing.utilitiesIncluded || []).includes(c)])));
  }, [listing]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amenities: AMENITY_COLS.filter((c) => amenities[c]),
          utilities_included: UTILITY_COLS.filter((c) => utilities[c]),
        }),
      });
      if (res.ok) toast.success("Saved");
      else toast.error("Failed to save");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Amenities</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {AMENITY_COLS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={!!amenities[c]} onChange={(e) => setAmenities((p) => ({ ...p, [c]: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300" />
              {AMENITY_LABELS[c]}
            </label>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Utilities included</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {UTILITY_COLS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={!!utilities[c]} onChange={(e) => setUtilities((p) => ({ ...p, [c]: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300" />
              {UTILITY_LABELS[c]}
            </label>
          ))}
        </div>
      </div>
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

// ── Pet policy tab ─────────────────────────────────────────────────────────────
function PetPolicyTab({ listingId }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/landlord/listings/${listingId}/pet-policy`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setText(d.policy_text || ""); });
  }, [listingId]);

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/landlord/listings/${listingId}/pet-policy`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_text: text }),
    });
    setSaving(false);
    if (res.ok) toast.success("Saved"); else toast.error("Failed");
  };

  return (
    <div>
      <p className="text-sm text-gray-500 mb-3">Describe your pet policy in plain text. AI will extract and display this to students.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
        placeholder="e.g. Small dogs and cats allowed with a $300 pet deposit. No large breeds."
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
      <SaveBar saving={saving} onSave={save} />
    </div>
  );
}

// ── Photos tab ─────────────────────────────────────────────────────────────────
function PhotosTab({ listingId, listing }) {
  const [images, setImages] = useState(listing.images || []);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const upload = async (files) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setUploading(true);
    const fd = new FormData();
    imgs.forEach((f) => fd.append("files", f));
    fd.append("listingId", listingId);
    const res = await fetch("/api/upload", { method: "PATCH", body: fd });
    const data = await res.json();
    if (res.ok) { setImages((p) => [...p, ...(data.urls || [])]); toast.success("Photos uploaded"); }
    else toast.error(data.error || "Upload failed");
    setUploading(false);
  };

  const remove = async (url) => {
    const res = await fetch(`/api/landlord/listings/${listingId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: images.filter((u) => u !== url) }),
    });
    if (res.ok) { setImages((p) => p.filter((u) => u !== url)); toast.success("Photo removed"); }
  };

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-red-300 transition"
      >
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => upload(e.target.files)} />
        <p className="text-sm text-gray-600">{uploading ? "Uploading…" : "Drop photos here or click to upload"}</p>
      </div>
      {images.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {images.map((url) => (
            <div key={url} className="relative aspect-square group rounded-lg overflow-hidden border border-gray-200">
              <img src={url} alt="" className="w-full h-full object-cover" />
              <button onClick={() => remove(url)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FAQs tab ───────────────────────────────────────────────────────────────────
function FaqsTab({ listingId }) {
  const [faqs, setFaqs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newFaq, setNewFaq] = useState({ question: "", answer: "" });

  useEffect(() => {
    fetch(`/api/landlord/listings/${listingId}/faqs`)
      .then((r) => r.ok ? r.json() : [])
      .then(setFaqs);
  }, [listingId]);

  const add = async () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim()) { toast.error("Question and answer required"); return; }
    const res = await fetch(`/api/landlord/listings/${listingId}/faqs`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newFaq, source: "landlord_authored" }),
    });
    const data = await res.json();
    if (res.ok) { setFaqs((p) => [...p, data]); setNewFaq({ question: "", answer: "" }); setAdding(false); }
    else toast.error(data.error || "Failed");
  };

  const togglePublic = async (faq) => {
    const res = await fetch(`/api/landlord/listings/${listingId}/faqs/${faq.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: !faq.is_public }),
    });
    if (res.ok) setFaqs((p) => p.map((f) => f.id === faq.id ? { ...f, is_public: !f.is_public } : f));
  };

  const remove = async (id) => {
    await fetch(`/api/landlord/listings/${listingId}/faqs/${id}`, { method: "DELETE" });
    setFaqs((p) => p.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-4">
      {faqs.length === 0 && !adding && (
        <p className="text-sm text-gray-400">No FAQs yet. Add common questions students ask.</p>
      )}
      <div className="space-y-3">
        {faqs.map((f) => (
          <div key={f.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{f.question}</p>
                <p className="text-sm text-gray-600 mt-1">{f.answer}</p>
                {f.source !== "landlord_authored" && (
                  <span className="text-xs text-blue-600 mt-1 inline-block">AI generated</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => togglePublic(f)}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${f.is_public ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {f.is_public ? "Public" : "Hidden"}
                </button>
                <button onClick={() => remove(f.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {adding ? (
        <div className="border border-red-200 rounded-lg p-4 bg-gray-50 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Question</label>
            <input type="text" value={newFaq.question} onChange={(e) => setNewFaq((p) => ({ ...p, question: e.target.value }))}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Answer</label>
            <textarea value={newFaq.answer} onChange={(e) => setNewFaq((p) => ({ ...p, answer: e.target.value }))} rows={3}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={add} className="px-4 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700">Add FAQ</button>
            <button onClick={() => setAdding(false)} className="px-4 py-1.5 text-sm text-gray-600">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-sm text-red-600 hover:text-red-700 font-medium">+ Add FAQ</button>
      )}
    </div>
  );
}

// ── Verification tab ──────────────────────────────────────────────────────────
function VerificationTab({ listingId, listing }) {
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    const res = await fetch(`/api/landlord/listings/${listingId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ last_verified_at: new Date().toISOString(), last_verified_source: "landlord_self" }),
    });
    setSaving(false);
    if (res.ok) toast.success("Listing marked as verified");
    else toast.error("Failed");
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-50 rounded-lg p-5">
        <p className="text-sm font-medium text-gray-900 mb-1">Last verified</p>
        <p className="text-sm text-gray-600">
          {listing.last_verified_at
            ? new Date(listing.last_verified_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
            : "Never verified"}
          {listing.last_verified_source && (
            <span className="ml-2 text-xs text-gray-400">({listing.last_verified_source.replace(/_/g, " ")})</span>
          )}
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Listings unverified for 90+ days are deprioritised in matching. Click below to confirm everything is current.
        </p>
      </div>
      <button onClick={confirm} disabled={saving}
        className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition">
        {saving ? "Saving…" : "✓ Confirm everything is current"}
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ListingEditPage() {
  const { listingId } = useParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("basics");
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/listing/${listingId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setListing(d); setLoading(false); });
  }, [listingId]);

  const patchListing = async (updates) => {
    const res = await fetch(`/api/landlord/listings/${listingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
    const updated = await res.json();
    setListing((prev) => ({ ...prev, ...updated }));
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading…</div>
  );
  if (!listing) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
      Listing not found.{" "}
      <Link href="/dashboard/landlord" className="text-red-600 underline ml-1">Back</Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link href="/dashboard/landlord?tab=properties" className="text-sm text-gray-500 hover:text-gray-800">← Dashboard</Link>
        <span className="text-gray-300">/</span>
        <p className="text-sm font-semibold text-gray-900 truncate">{listing.title || listing.address}</p>
        <div className="ml-auto flex gap-2">
          <Link href={`/dashboard/landlord/listings/${listingId}/leases`}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition">
            Lease offers
          </Link>
          <a href={`/browse?panel=${listingId}`} target="_blank" rel="noopener noreferrer"
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition">
            View as student ↗
          </a>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Tab bar */}
        <nav className="flex overflow-x-auto gap-1 mb-6 bg-white rounded-xl border border-gray-200 p-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition
                ${activeTab === t.id ? "bg-red-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          {activeTab === "basics"      && <BasicsTab listing={listing} onSave={patchListing} />}
          {activeTab === "amenities"   && <AmenitiesTab listingId={listingId} listing={listing} />}
          {activeTab === "pet-policy"  && <PetPolicyTab listingId={listingId} />}
          {activeTab === "fees" && (
            <div className="text-sm text-gray-500 text-center py-8">
              Fee management available from the{" "}
              <a href="#" onClick={() => setActiveTab("basics")} className="text-red-600 underline">Details tab</a>{" "}
              — or use the <Link href={`/dashboard/landlord/listings/${listingId}/leases`} className="text-red-600 underline">lease offers page</Link> to add per-lease fees.
            </div>
          )}
          {activeTab === "concessions" && (
            <div className="text-sm text-gray-500 text-center py-8">
              Concession management coming soon — currently editable via the API.
            </div>
          )}
          {activeTab === "photos"      && <PhotosTab listingId={listingId} listing={listing} />}
          {activeTab === "faqs"        && <FaqsTab listingId={listingId} />}
          {activeTab === "verify"      && <VerificationTab listingId={listingId} listing={listing} />}
        </div>
      </div>
    </div>
  );
}
