"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const STATUS_COLORS = {
  draft:                "bg-gray-100 text-gray-600",
  landlord_reviewing:   "bg-yellow-100 text-yellow-700",
  landlord_approved:    "bg-blue-100 text-blue-700",
  sent_to_tenant:       "bg-purple-100 text-purple-700",
  tenant_signed:        "bg-indigo-100 text-indigo-700",
  landlord_countersigned: "bg-indigo-100 text-indigo-700",
  fully_executed:       "bg-green-100 text-green-700",
  cancelled:            "bg-red-100 text-red-600",
  rejected:             "bg-red-100 text-red-600",
};

const STATUS_LABELS = {
  draft:                "Draft",
  landlord_reviewing:   "Reviewing",
  landlord_approved:    "Approved",
  sent_to_tenant:       "Sent to tenant",
  tenant_signed:        "Tenant signed",
  landlord_countersigned: "Countersigned",
  fully_executed:       "Executed ✓",
  cancelled:            "Cancelled",
  rejected:             "Rejected",
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || "bg-gray-100 text-gray-500"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export default function LeaseVaultTab({ user }) {
  const [templates, setTemplates] = useState([]);
  const [leases, setLeases] = useState([]);
  const [listingId, setListingId] = useState("all");
  const [loading, setLoading] = useState(true);

  const listings = user?.listings || [];

  useEffect(() => {
    fetch("/api/landlord/lease-templates")
      .then((r) => r.json())
      .then((d) => setTemplates(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    if (!listings.length) { setLoading(false); return; }
    const targets = listingId === "all" ? listings.map((l) => l._id || l.id) : [listingId];
    Promise.all(
      targets.map((id) =>
        fetch(`/api/landlord/executed-leases?listing_id=${id}`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
      )
    ).then((results) => {
      setLeases(results.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      setLoading(false);
    });
  }, [listings, listingId]);

  return (
    <div className="space-y-8 max-w-4xl">

      {/* Templates */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Lease templates</h2>
          <Link href="/add-listing" className="text-xs text-red-600 hover:text-red-700 font-medium">
            + Upload via add listing
          </Link>
        </div>
        {templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            No templates yet. Upload a lease PDF during the add-listing wizard.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-gray-200">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t.display_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Uploaded {new Date(t.uploaded_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  {t.extracted_fields ? (
                    <span className="text-xs text-green-600 font-medium">✓ Extracted</span>
                  ) : (
                    <button
                      onClick={async () => {
                        await fetch(`/api/landlord/lease-templates/${t.id}/extract`, { method: "POST" });
                        window.location.reload();
                      }}
                      className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                    >
                      Extract with AI
                    </button>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {t.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Executed leases */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">Lease vault</h2>
          {listings.length > 1 && (
            <select
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700"
            >
              <option value="all">All listings</option>
              {listings.map((l) => (
                <option key={l._id || l.id} value={l._id || l.id}>
                  {l.title || l.address}
                </option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-4">Loading…</div>
        ) : leases.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
            No lease vault entries yet. Start a chat with a student, then click &ldquo;Start lease draft from this chat.&rdquo;
          </div>
        ) : (
          <div className="space-y-2">
            {leases.map((lease) => {
              const listing = listings.find((l) => (l._id || l.id) === lease.listing_id);
              const tenants = lease.executed_lease_tenants || [];
              const pendingRedlines = (lease.lease_redlines || []).filter((r) => r.status === "pending").length;
              return (
                <div key={lease.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-gray-200">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {listing?.title || listing?.address || "Listing"}
                      </p>
                      <StatusBadge status={lease.status} />
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {tenants.map((t) => t.full_name).join(", ") || "No tenants added"}
                      {" · "}
                      {new Date(lease.draft_created_at).toLocaleDateString()}
                    </p>
                    {pendingRedlines > 0 && (
                      <p className="text-xs text-yellow-600 mt-0.5">{pendingRedlines} redline{pendingRedlines !== 1 ? "s" : ""} awaiting review</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {["draft", "landlord_reviewing", "landlord_approved"].includes(lease.status) && (
                      <Link
                        href={`/dashboard/landlord/lease-vault/${lease.id}`}
                        className="text-xs text-red-600 hover:text-red-700 font-medium"
                      >
                        Review →
                      </Link>
                    )}
                    {lease.status === "fully_executed" && lease.signed_lease_pdf_url && (
                      <a href={lease.signed_lease_pdf_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-green-700 hover:text-green-800 font-medium">
                        Download PDF
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
