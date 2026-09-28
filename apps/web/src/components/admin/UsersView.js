"use client";

import { useState } from "react";
import { fmtDate, fmtMoney, shortId, sortByDate, SortToggle, SORT_NEWEST, Stars, Badge, GearButton } from "@/components/admin/adminShared";

function roleColor(role) {
  if (role === "super") return "red";
  if (role === "admin") return "purple";
  if (role === "landlord") return "blue";
  return "gray";
}

export default function UsersView({ data, search, onOpenGear }) {
  const [expanded, setExpanded] = useState(new Set());
  const [roleFilter, setRoleFilter] = useState("all");
  // The route already returns newest first; this makes that visible and
  // reversible rather than an invisible property of the query.
  const [sort, setSort] = useState(SORT_NEWEST);

  const users = data || [];
  const q = search.trim().toLowerCase();
  const filtered = sortByDate(
    users.filter((u) => {
      const role = u.roles?.name || "student";
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (!q) return true;
      return [u.name, u.email, u.id].some((v) => (v || "").toLowerCase().includes(q));
    }),
    sort
  );

  const roles = ["all", ...new Set(users.map((u) => u.roles?.name || "student"))];

  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs text-gray-500">{filtered.length} of {users.length} users</p>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <SortToggle value={sort} onChange={setSort} label="Joined" />
          <div className="flex items-center gap-1">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={`px-2 py-0.5 text-[11px] rounded-full border ${
                roleFilter === r ? "bg-gray-800 border-gray-800 text-white" : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              {r}
            </button>
          ))}
          </div>
        </div>
      </div>

      {filtered.map((u) => {
        const isOpen = expanded.has(u.id);
        const role = u.roles?.name || "student";
        const listings = (u.listing_landlords || []).map((ll) => ll.listings).filter(Boolean);
        const reviews = (u.listing_reviews || []).filter((r) => !r.deleted_at);
        const prefs = Array.isArray(u.matchmaking_preferences) ? u.matchmaking_preferences[0] : u.matchmaking_preferences;

        return (
          <div key={u.id} className={`rounded-xl border bg-white shadow-sm ${u.deleted_at ? "border-red-200" : "border-gray-200"}`}>
            <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none" onClick={() => toggleExpand(u.id)}>
              <svg className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{u.name || <span className="italic text-gray-400">(no name)</span>}</p>
                <p className="text-[11px] text-gray-400 truncate">{u.email}</p>
              </div>
              <Badge color={roleColor(role)}>{role}</Badge>
              {u.is_system && <Badge color="purple" title="System account (e.g. guest tester)">system</Badge>}
              {u.deleted_at && <Badge color="red">deleted</Badge>}
              {!u.profile_complete && <Badge color="amber" title="Profile completion modal still pending">incomplete</Badge>}
              <span className="hidden sm:block text-[11px] text-gray-400 whitespace-nowrap">joined {fmtDate(u.created_at)}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <GearButton onClick={() => onOpenGear("users", u)} />
              </span>
            </div>

            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100 bg-gray-50/60">
                <div className="grid sm:grid-cols-3 gap-x-4 gap-y-1 text-xs text-gray-600">
                  <p><span className="text-gray-400">Phone:</span> {u.phone || "—"}</p>
                  <p><span className="text-gray-400">Graduation:</span> {u.graduation_year ? `${u.graduation_month ?? "?"}/${u.graduation_year}` : "—"}</p>
                  <p><span className="text-gray-400">Sign-in:</span> {u.google_account ? "Google" : "Email/password"}{u.email_verified === false ? " (unverified)" : ""}</p>
                  <p><span className="text-gray-400">Referral source:</span> {u.referral_source || "—"}</p>
                  <p className="font-mono text-gray-400">{shortId(u.id)}</p>
                </div>

                {listings.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Listings ({listings.length})</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {listings.map((l) => (
                        <span key={l.id} className="px-2 py-0.5 text-xs bg-white border border-gray-200 rounded-full text-gray-700">
                          {l.title || l.address}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {reviews.length > 0 && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Reviews written ({reviews.length})</h4>
                    <div className="space-y-1">
                      {reviews.map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-xs">
                          <Stars rating={r.rating} />
                          <span className="text-gray-600 truncate">{r.listings?.title || r.listings?.address || "unknown listing"}</span>
                          {!r.legitimacy && <Badge color="amber">unverified</Badge>}
                          <span className="text-gray-400">{fmtDate(r.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {prefs && (
                  <div>
                    <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Matchmaking preferences</h4>
                    <p className="text-xs text-gray-600">
                      Budget {fmtMoney(prefs.budget_min)}–{fmtMoney(prefs.budget_max)}
                      {prefs.group_size != null && ` · group of ${prefs.group_size}`}
                      {prefs.move_in_date_earliest && ` · move-in from ${fmtDate(prefs.move_in_date_earliest)}`}
                      {prefs.open_to_roommates && " · open to roommates"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {filtered.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No users match.</p>}
    </div>
  );
}
