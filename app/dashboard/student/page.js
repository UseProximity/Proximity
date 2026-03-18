"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { getRentRangeLabel } from "@/utils/listingFormatters";

// ─── Edit Profile Modal ────────────────────────────────────────────────────────

function EditProfileModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:        user.name        || "",
    age:         user.age         || "",
    gender:      (user.gender || "unspecified").toLowerCase(),
    role:        (user.role   || "student").toLowerCase(),
    phone:       user.phone       || "",
    description: user.description || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/editProfile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          age: form.age !== "" ? Number(form.age) : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      const updated = await res.json();
      onSaved(updated);
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
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 relative">
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
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
            <input
              type="text"
              name="name"
              value={form.name}
              onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          {/* Age + Gender row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Age</label>
              <input
                type="number"
                name="age"
                min={13}
                max={120}
                value={form.age}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Gender</label>
              <select
                name="gender"
                value={form.gender}
                onChange={handleChange}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              >
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
            <select
              name="role"
              value={form.role}
              onChange={handleChange}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              <option value="student">Student</option>
              <option value="landlord">Landlord</option>
            </select>
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              placeholder="e.g. (314) 555-0100"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Bio</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={3}
              placeholder="Tell landlords a bit about yourself…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
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
  const [streetAddress, ...rest] = (listing.address || "").split(",");
  const cityStateZip = rest.join(",").trim();
  const bedValues = listing.unitTypes.map((u) => u.bedrooms).filter(Number.isFinite);
  const bathValues = listing.unitTypes.map((u) => u.bathrooms).filter(Number.isFinite);
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
    <Link href={`/browse?listing=${listing._id}`} className="group block">
      <div className="relative bg-white rounded-2xl shadow-md overflow-hidden border border-gray-100 hover:border-red-200 transition-colors duration-200 flex flex-col">
        <div className="relative">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={listing.address}
              className="w-full aspect-video object-cover"
            />
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
              <h3 className="font-bold text-sm text-gray-900 leading-snug">
                {streetAddress}
              </h3>
              {cityStateZip && (
                <p className="text-xs text-gray-500 mt-0.5">{cityStateZip}</p>
              )}
            </div>
            <span className="text-red-500 font-bold text-sm whitespace-nowrap flex-shrink-0">
              {getRentRangeLabel(listing.unitTypes)}
              <span className="text-xs font-normal">/mo</span>
            </span>
          </div>
          <div className="mt-auto pt-2">
            <span className="text-gray-500 text-xs">
              {bedLabel} bed {" | "} {bathLabel} bath
              {listing.leaseType ? ` | ${listing.leaseType}` : ""}
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

// ─── Main page ────────────────────────────────────────────────────────────────

const CARDS_PER_PAGE = 2;

export default function StudentDashboardPage() {
  // useSession gives us instant name/image/email without waiting for the API
  const { data: session } = useSession();
  const [dbUser, setDbUser] = useState(null);
  const [contactedPage, setContactedPage] = useState(0);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    fetch("/api/getUser")
      .then((r) => r.json())
      .then((data) => {
        // Only store if it's a real user record, not an error object
        if (!data?.error) setDbUser(data);
      })
      .catch(console.error);
  }, []);

  // Merge: session is always available when logged in; dbUser adds DB fields
  const user = {
    name:        dbUser?.name        ?? session?.user?.name  ?? null,
    email:       dbUser?.email       ?? session?.user?.email ?? null,
    image:       dbUser?.image       ?? session?.user?.image ?? null,
    createdAt:   dbUser?.createdAt   ?? null,
    numReviews:  dbUser?.numReviews  ?? 0,
    listings:    dbUser?.listings    ?? [],
    favorites:   dbUser?.favorites   ?? [],
    contacted:   dbUser?.contacted   ?? [],
    age:         dbUser?.age         ?? null,
    gender:      dbUser?.gender      ?? null,
    role:        dbUser?.role        ?? "student",
    phone:       dbUser?.phone       ?? null,
    description: dbUser?.description ?? null,
  };

  const contacted = user.contacted;
  const favorites = user.favorites;
  const joinedYear = user.createdAt ? new Date(user.createdAt).getFullYear() : "—";

  const contactedPages = Math.max(1, Math.ceil(contacted.length / CARDS_PER_PAGE));
  const contactedVisible = contacted.slice(
    contactedPage * CARDS_PER_PAGE,
    contactedPage * CARDS_PER_PAGE + CARDS_PER_PAGE
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-10 py-10">

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 mb-8">My Account</h1>
        <div className="border-b border-gray-200 mb-8" />

        {/* Two-column layout */}
        <div className="grid grid-cols-[1fr_2.5fr] gap-10 items-start">

          {/* ── LEFT COLUMN ── */}
          <div className="space-y-5">

            {/* Profile card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex flex-col items-center text-center relative">
                <button
                  onClick={() => setEditOpen(true)}
                  className="absolute top-0 right-0 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l-4 1 1-4L15.232 5.232a2 2 0 012.828 0l.708.708a2 2 0 010 2.828L9 13z" />
                  </svg>
                </button>

                {/* Avatar */}
                {user?.image ? (
                  <img
                    src={user.image}
                    alt={user.name}
                    className="w-20 h-20 rounded-full object-cover border border-gray-200 shadow mb-4"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  </div>
                )}

                <h2 className="font-bold text-gray-900 text-base leading-tight">
                  {user?.name || "—"}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5 capitalize">{user.role || "Student"}</p>
                {(user.age || (user.gender && user.gender !== "unspecified")) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[
                      user.age ? `Age ${user.age}` : null,
                      user.gender && user.gender !== "unspecified" ? user.gender : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">Washington University in St. Louis</p>

                <div className="w-full border-t border-gray-100 mt-4 pt-4 flex justify-around text-sm">
                  <div className="text-center">
                    <p className="font-semibold text-gray-800">Joined {joinedYear}</p>
                  </div>
                </div>
                <div className="w-full flex justify-around text-sm mt-3">
                  <div className="text-center">
                    <p className="font-semibold text-gray-800">{user?.numReviews ?? 0}</p>
                    <p className="text-xs text-gray-400">Posts</p>
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-gray-800">{user?.listings?.length ?? 0}</p>
                    <p className="text-xs text-gray-400">Leases Signed</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Notifications card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
              </div>
              <div className="text-center py-6 text-gray-400 text-sm">
                No new notifications
              </div>
            </div>

            {/* Recent Activity card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 text-sm mb-4">Recent Activity</h3>
              <div className="text-center py-6 text-gray-400 text-sm">
                No recent activity
              </div>
            </div>
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
                  <Link
                    href="/browse"
                    className="inline-block px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    Browse Listings
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    🎉 Congrats, you&apos;ve reached out to the leasing agent. Check your email and phone number for updates.
                  </p>
                  <div className="grid grid-cols-2 gap-5 mb-4">
                    {contactedVisible.map((listing) => (
                      <ListingCard key={listing._id} listing={listing} badge={<CheckBadge />} />
                    ))}
                  </div>
                  {contactedPages > 1 && (
                    <div className="flex items-center gap-1 text-sm">
                      {Array.from({ length: contactedPages }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setContactedPage(i)}
                          className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                            i === contactedPage
                              ? "font-bold text-gray-900 underline"
                              : "text-gray-500 hover:text-gray-800"
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                      {contactedPage < contactedPages - 1 && (
                        <button
                          onClick={() => setContactedPage((p) => Math.min(p + 1, contactedPages - 1))}
                          className="ml-1 text-gray-500 hover:text-gray-800"
                        >
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
                  <Link
                    href="/browse"
                    className="inline-block px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    Browse Listings
                  </Link>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500 mb-4">
                    Psst... Don&apos;t forget about these listings! Follow-up before they get signed!
                  </p>
                  <div className="grid grid-cols-2 gap-5 mb-5">
                    {favorites.slice(0, 4).map((listing) => (
                      <ListingCard key={listing._id} listing={listing} />
                    ))}
                  </div>
                  {favorites.length > 4 && (
                    <Link
                      href="/browse"
                      className="group relative block w-full rounded-2xl overflow-hidden shadow-md"
                    >
                      {favorites[4]?.images?.[0] && (
                        <img
                          src={favorites[4].images[0]}
                          alt="View all saved"
                          className="w-full h-40 object-cover brightness-50"
                        />
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
          </div>
        </div>
      </div>

      {editOpen && (
        <EditProfileModal
          user={user}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            // Only merge profile fields — don't clobber populated favorites/listings/contacted
            setDbUser((prev) => ({
              ...prev,
              name:        updated.name,
              age:         updated.age,
              gender:      updated.gender,
              role:        updated.role,
              phone:       updated.phone,
              description: updated.description,
            }));
          }}
        />
      )}
    </div>
  );
}
