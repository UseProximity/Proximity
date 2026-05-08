"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { groupLeasesByUnit, findConflictingLeases } from "@/lib/leases/conflictDetection";

const BASIS_LABEL = { per_unit: "/ mo", per_bed: "/ bed/mo" };

function LeaseRow({ lease, onToggle, onDisable, disabling }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 rounded-lg border transition
      ${!lease.is_active || lease.deleted_at ? "bg-gray-50 border-gray-200 opacity-60" : "bg-white border-gray-200"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium text-gray-900">
            {lease.bedrooms}BR / {lease.bathrooms}BA
          </span>
          {lease.area && <span className="text-gray-400">{lease.area} sqft</span>}
          <span className="font-semibold text-gray-900">
            ${Number(lease.rent).toLocaleString()}
            <span className="text-xs text-gray-400 font-normal ml-0.5">{BASIS_LABEL[lease.pricing_basis] || "/mo"}</span>
          </span>
          <span className="text-gray-500">{lease.lease_term_months}mo</span>
          {lease.available_from && (
            <span className="text-xs text-gray-400">from {new Date(lease.available_from).toLocaleDateString()}</span>
          )}
        </div>
        {lease.disabled_reason && (
          <p className="text-xs text-orange-600 mt-0.5">{lease.disabled_reason.replace(/_/g, " ")}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-3">
        {lease.is_active && !lease.deleted_at && (
          <button
            onClick={() => onDisable(lease.id)}
            disabled={disabling === lease.id}
            className="text-xs text-orange-600 hover:text-orange-700 font-medium disabled:opacity-50"
          >
            Disable
          </button>
        )}
        <button
          onClick={() => onToggle(lease.id, !lease.is_active)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            lease.is_active && !lease.deleted_at ? "bg-green-500" : "bg-gray-300"
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            lease.is_active && !lease.deleted_at ? "translate-x-4.5" : "translate-x-0.5"
          }`} />
        </button>
      </div>
    </div>
  );
}

function UnitGroup({ groupKey, leases, signedLeases, onToggle, onDisable, onAutoDisable, disabling }) {
  const signed = signedLeases.find((s) => s.unit_group_label === groupKey && !groupKey.startsWith("_ungrouped_"));
  const hasConflict = !!signed;
  const conflicting = signed ? findConflictingLeases(leases, signed) : [];
  const isLabelled = !groupKey.startsWith("_ungrouped_");

  return (
    <div className="mb-5">
      {isLabelled && (
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Unit group: {groupKey}
        </p>
      )}

      {hasConflict && conflicting.length > 0 && (
        <div className="mb-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-orange-800">
              A {signed.bedrooms}BR lease was signed in this group.
            </p>
            <p className="text-xs text-orange-600 mt-0.5">
              {conflicting.length} other offer{conflicting.length !== 1 ? "s" : ""} may no longer be available.
            </p>
          </div>
          <button
            onClick={() => onAutoDisable(conflicting.map((l) => l.id))}
            className="text-xs px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition shrink-0"
          >
            Auto-disable {conflicting.length} conflicting
          </button>
        </div>
      )}

      <div className="space-y-2">
        {leases.map((l) => (
          <LeaseRow
            key={l.id}
            lease={l}
            onToggle={onToggle}
            onDisable={onDisable}
            disabling={disabling}
          />
        ))}
      </div>
    </div>
  );
}

export default function LeaseTermManagementPage() {
  const { listingId } = useParams();
  const [leases, setLeases] = useState([]);
  const [executedLeases, setExecutedLeases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [disabling, setDisabling] = useState(null);

  const refresh = async () => {
    const [leasesRes, executedRes] = await Promise.all([
      fetch(`/api/landlord/leases?listing_id=${listingId}`),
      fetch(`/api/landlord/executed-leases?listing_id=${listingId}&status=fully_executed`),
    ]);
    if (leasesRes.ok) setLeases(await leasesRes.json());
    if (executedRes.ok) setExecutedLeases(await executedRes.json());
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [listingId]);

  const toggle = async (leaseId, active) => {
    const res = await fetch(`/api/landlord/leases/${leaseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: active }),
    });
    if (res.ok) { await refresh(); toast.success(active ? "Enabled" : "Disabled"); }
    else toast.error("Failed to update");
  };

  const disable = async (leaseId) => {
    setDisabling(leaseId);
    const res = await fetch(`/api/landlord/leases/${leaseId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false, disabled_reason: "manually_disabled" }),
    });
    setDisabling(null);
    if (res.ok) { await refresh(); toast.success("Lease offer disabled"); }
    else toast.error("Failed to disable");
  };

  const autoDisable = async (ids) => {
    await Promise.all(ids.map((id) =>
      fetch(`/api/landlord/leases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: false, disabled_reason: "auto_disabled_due_to_conflict" }),
      })
    ));
    await refresh();
    toast.success(`${ids.length} conflicting offer${ids.length !== 1 ? "s" : ""} disabled`);
  };

  // Signed listing_leases (via fully_executed → listing_lease_id)
  const signedLeaseIds = new Set(executedLeases.map((e) => e.listing_lease_id).filter(Boolean));
  const signedLeases = leases.filter((l) => signedLeaseIds.has(l.id));

  const groups = groupLeasesByUnit(leases.filter((l) => !l.deleted_at));

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">Loading…</div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Link href="/dashboard/landlord?tab=properties" className="text-sm text-gray-500 hover:text-gray-800">
          ← Dashboard
        </Link>
        <span className="text-gray-300">/</span>
        <p className="text-sm font-semibold text-gray-900">Lease term management</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Lease offers</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Toggle offers on/off. Disable conflicting options when a unit is signed.
            </p>
          </div>
          <Link
            href={`/dashboard/landlord/listings/${listingId}/edit`}
            className="text-xs text-red-600 hover:text-red-700 font-medium"
          >
            Edit listing →
          </Link>
        </div>

        {leases.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400">
            No lease offers yet.{" "}
            <Link href="/add-listing" className="text-red-600 hover:text-red-700">Add via new listing wizard.</Link>
          </div>
        ) : (
          Object.entries(groups).map(([key, groupLeases]) => (
            <UnitGroup
              key={key}
              groupKey={key}
              leases={groupLeases}
              signedLeases={signedLeases}
              onToggle={toggle}
              onDisable={disable}
              onAutoDisable={autoDisable}
              disabling={disabling}
            />
          ))
        )}
      </div>
    </div>
  );
}
