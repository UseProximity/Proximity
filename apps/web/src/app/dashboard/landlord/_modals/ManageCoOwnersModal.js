"use client";

import { useState, useEffect } from "react";
import { X, User, UserPlus } from "lucide-react";

export default function ManageCoOwnersModal({ listing, currentUserId, onClose }) {
  const listingId = listing._id || listing.id;
  const [landlords, setLandlords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [promoting, setPromoting] = useState(null);

  const currentIsPrimary =
    landlords.find((l) => l.userId === currentUserId)?.isPrimary ?? false;

  useEffect(() => {
    fetch(`/api/landlord/listings/${listingId}/landlords`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLandlords(data);
      })
      .catch(() => setError("Failed to load co-owners."))
      .finally(() => setLoading(false));
  }, [listingId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(null);
    setAdding(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/landlords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add co-owner.");
        return;
      }
      setLandlords((prev) => [...prev, data]);
      setEmail("");
    } catch {
      setError("Network error.");
    } finally {
      setAdding(false);
    }
  };

  const handleMakePrimary = async (userId) => {
    const target = landlords.find((l) => l.userId === userId);
    const name = target?.name || target?.email || "this person";
    if (
      !confirm(`Make ${name} the primary owner? You will lose primary status.`)
    )
      return;
    setError(null);
    setPromoting(userId);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/landlords`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to transfer primary.");
        return;
      }
      setLandlords((prev) =>
        prev.map((l) => ({ ...l, isPrimary: l.userId === userId }))
      );
    } catch {
      setError("Network error.");
    } finally {
      setPromoting(null);
    }
  };

  const handleRemove = async (userId) => {
    setError(null);
    setRemoving(userId);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/landlords`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to remove co-owner.");
        return;
      }
      setLandlords((prev) => prev.filter((l) => l.userId !== userId));
    } catch {
      setError("Network error.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Co-owners</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
              {listing.title || listing.address}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              People with access
            </p>
            {loading ? (
              <p className="text-sm text-gray-400 py-2">Loading…</p>
            ) : (
              <ul className="space-y-2">
                {landlords.map((l) => (
                  <li
                    key={l.userId}
                    className="flex items-center justify-between gap-3 py-1"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {l.name || l.email || "Unknown"}
                          {l.isPrimary && (
                            <span className="ml-2 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded uppercase tracking-wide">
                              Primary
                            </span>
                          )}
                        </p>
                        {l.name && l.email && (
                          <p className="text-xs text-gray-400 truncate">
                            {l.email}
                          </p>
                        )}
                      </div>
                    </div>
                    {!l.isPrimary && (
                      <div className="flex items-center gap-1 shrink-0">
                        {currentIsPrimary && (
                          <button
                            onClick={() => handleMakePrimary(l.userId)}
                            disabled={!!promoting}
                            className="text-xs text-purple-600 hover:text-purple-700 font-medium px-2 py-1 rounded-md hover:bg-purple-50 transition-colors disabled:opacity-50"
                          >
                            {promoting === l.userId
                              ? "Saving…"
                              : "Make Primary"}
                          </button>
                        )}
                        {l.userId !== currentUserId && (
                          <button
                            onClick={() => handleRemove(l.userId)}
                            disabled={removing === l.userId}
                            className="text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
                          >
                            {removing === l.userId ? "Removing…" : "Remove"}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Add co-owner by email
            </p>
            <form onSubmit={handleAdd} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="landlord@email.com"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <button
                type="submit"
                disabled={adding || !email.trim()}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                {adding ? "Adding…" : "Add"}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-1.5">
              The person must already have a Proximity account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
