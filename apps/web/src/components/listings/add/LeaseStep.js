"use client";

/*
 * The last step, and the only one every path reaches: your terms on this
 * apartment. Rent, when it's free, how long, how to reach you.
 *
 * A sublease is offerable whether or not the unit already has a live lease.
 * Subletting is taking over part of a lease that exists, so the unit already
 * being let is the normal case — see 202608240003, which removed the guard that
 * had it backwards.
 */

import { Users } from "lucide-react";
import LeaseTermPicker from "@/components/listings/LeaseTermPicker";
import { LEASE_DESCRIPTION_MAX } from "@/lib/listings/leaseDescription";

export default function LeaseStep({ unit, existingLeases = [], value, onChange, invalid = null }) {
  // `invalid` is a Set of field keys the parent found missing on publish, or
  // null before they have tried. Marking a field they have not reached yet
  // would be scolding them for not having finished.
  const bad = (key) => (invalid?.has(key) ? "border-red-400 ring-1 ring-red-200" : "");
  const set = (patch) => onChange({ ...value, ...patch });
  const field =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none";
  const live = existingLeases.filter((l) => l.live);

  return (
    <div className="space-y-4">
      {live.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <p>
            {live.length === 1 ? "One landlord is" : `${live.length} landlords are`} already listing
            this apartment. Your lease will appear alongside theirs.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Rent per month
          </span>
          <input
            type="number" className={field} value={value.rent}
            placeholder="Leave blank for “Contact for pricing”"
            onChange={(e) => set({ rent: e.target.value })}
          />
          {/*
            * Which number they typed. Without this we have to infer it from the
            * bedroom count, and a $2,800 four-bed could mean either.
            */}
          <div className="mt-2 inline-flex rounded-lg bg-gray-100 p-0.5 text-xs">
            {[[false, "for the whole unit"], [true, "per person"]].map(([v, label]) => (
              <button
                key={label} type="button"
                onClick={() => set({ rentIsPerPerson: v })}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  value.rentIsPerPerson === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Available on
          </span>
          <input
            type="date" className={field} value={value.availableFrom}
            onChange={(e) => set({ availableFrom: e.target.value })}
          />
          <span className="mt-1 block text-xs text-gray-400">
            A date in the past shows{" "}
            <span className="font-semibold text-green-600">Now</span>.
          </span>
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
          Lease lengths you&apos;ll accept
        </span>
        <div
          data-invalid={!!invalid?.has("leaseTermMonths")}
          className={invalid?.has("leaseTermMonths")
            ? "rounded-lg ring-1 ring-red-200 p-1.5 -m-1.5"
            : ""}
        >
          <LeaseTermPicker
            value={value.leaseTermMonths}
            onChange={(next) => set({ leaseTermMonths: next })}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={value.sublease}
            onChange={(e) => set({ sublease: e.target.checked })} />
          This is a sublease
        </label>
        <label className="inline-flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={value.furnished}
            onChange={(e) => set({ furnished: e.target.checked })} />
          Furnished
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Contact email <span className="text-red-500">*</span>
          </span>
          <input type="email" required
            className={`${field} ${bad("contactEmail")}`}
            data-invalid={!!invalid?.has("contactEmail")}
            value={value.contactEmail}
            onChange={(e) => set({ contactEmail: e.target.value })} />
          <span className="mt-1 block text-xs text-gray-400">
            Where student enquiries about this apartment go.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Contact phone
          </span>
          <input className={field} value={value.contactPhone}
            onChange={(e) => set({ contactPhone: e.target.value })} />
        </label>
      </div>

      {/*
        * One line about this offering, not an essay about the building. It is
        * shown behind the chevron on the offering it belongs to, so it has to
        * fit there — and it is optional, because being made to write something
        * before you can publish produces filler, not information.
        */}
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-gray-500">
          <span>A short note about this listing</span>
          <span className="font-normal normal-case tracking-normal text-gray-400">
            Optional · {value.description.length}/{LEASE_DESCRIPTION_MAX}
          </span>
        </span>
        <textarea
          rows={2} className={field} value={value.description}
          maxLength={LEASE_DESCRIPTION_MAX}
          placeholder="Utilities included, on-street parking, cat-friendly…"
          onChange={(e) => set({ description: e.target.value })}
        />
        <span className="mt-1 block text-xs text-gray-400">
          Students see this when they open the details on your listing.
        </span>
      </label>
    </div>
  );
}
