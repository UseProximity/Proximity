"use client";

/*
 * Listing an apartment, as one page that grows.
 *
 * The old wizard asked the same questions in the same order regardless of what
 * we already knew, so a landlord adding one apartment to a building already on
 * the site re-entered the building. This asks the address first and lets the
 * answer decide what comes next:
 *
 *   unknown address  →  property → unit → lease   (a building we've never seen)
 *   known address    →  unit → lease              (pick from what's there)
 *   known unit       →  lease                     (nothing left to describe)
 *
 * Sections appear as the one above them is answered and stay open, so the whole
 * thing reads back as a single page rather than a sequence of screens — the same
 * property → unit → lease shape the browse panel uses, which is also the shape
 * of the data underneath.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import AddressStep from "./AddressStep";
import UnitStep from "./UnitStep";
import LeaseStep from "./LeaseStep";
import { clampCount } from "@/utils/unitCounts";

const emptyLease = (email) => ({
  rent: "",
  // Whole unit is the common case, so it is the default rather than an
  // unanswered question the landlord has to notice.
  rentIsPerPerson: false,
  availableFrom: "",
  leaseTermMonths: [12],
  sublease: false,
  furnished: false,
  contactEmail: email ?? "",
  contactPhone: "",
  description: "",
});

function Section({ n, title, subtitle, done, children }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? "bg-green-100 text-green-700" : "bg-red-600 text-white"}`}>
          {done ? <Check className="h-4 w-4" /> : n}
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export default function AddListingFlow({ user }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  /*
   * How far along the flow is lives in the URL, so the browser's own Back
   * button walks it: lease → unit → address → the start fork → off the page.
   * Component state holds the answers; the URL holds only how much to show.
   *
   * That means a reload has the address but not the lookup behind it, so the
   * step is clamped below to what the state can actually support rather than
   * rendering a lease form for a unit we no longer know.
   */
  const urlStep = searchParams.get("step");
  const [place, setPlace] = useState(null);          // resolved address + property
  const [unitMode, setUnitMode] = useState(null);    // "existing" | "new"
  const [unit, setUnit] = useState(null);            // chosen existing unit
  const [newUnit, setNewUnit] = useState({ designator: "", number: "", bedrooms: "", bathrooms: "", area: "" });
  const [lease, setLease] = useState(emptyLease(user?.email));
  const [submitting, setSubmitting] = useState(false);
  // Set once a listing is live, so the flow can offer another on the same unit
  // instead of walking the landlord back through the address.
  const [published, setPublished] = useState(null);

  const isKnownProperty = !!place?.property;
  // An unknown address has no units to choose from, so it goes straight to
  // describing the apartment.
  const unitResolved = unitMode === "existing" ? !!unit : unitMode === "new";

  // The URL asks for a step; the state decides how far we can honour it.
  const reachable = !place ? "address" : !unitResolved ? "unit" : "lease";
  const order = ["address", "unit", "lease"];
  const step = order[Math.min(
    order.indexOf(urlStep && order.includes(urlStep) ? urlStep : "address"),
    order.indexOf(reachable)
  )];

  const showUnitStep = !!place && order.indexOf(step) >= 1;
  const showLeaseStep = !!place && unitResolved && step === "lease";

  // Each advance is a history entry, which is what Back unwinds.
  const advance = (to) => router.push(`/add-listing?mode=manual&step=${to}`);

  const chooseExisting = (u) => { setUnit(u); setUnitMode("existing"); advance("lease"); };
  const chooseNew = () => { setUnit(null); setUnitMode("new"); };

  /*
   * An unknown address skips unit *selection* — there is nothing to select
   * from — but still needs the apartment described, so it opens the new-unit
   * fields directly. Done in an effect: deriving it during render would mean
   * setting state while rendering.
   */
  useEffect(() => {
    if (place && !isKnownProperty && unitMode === null) setUnitMode("new");
  }, [place, isKnownProperty, unitMode]);

  /*
   * A brand-new property has no unit to pick, so filling the unit fields is the
   * only thing standing between the address and the terms. Advance once they
   * are answered, so Back still has a stop between the two.
   */
  const newUnitReady = newUnit.bedrooms !== "" && newUnit.bathrooms !== "";
  useEffect(() => {
    if (unitMode === "new" && newUnitReady && step === "unit") advance("lease");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitMode, newUnitReady, step]);

  /*
   * What is actually missing, named. The button used to disable itself on a
   * condition it never explained: describing a new apartment opens the lease
   * step immediately, so a landlord could reach Publish with no bedroom count
   * and be told only that a contact email was needed — which they had already
   * given. Now the blocker is listed and the field it belongs to is marked.
   */
  const missing = [];
  if (unitMode === "new") {
    if (newUnit.bedrooms === "") missing.push({ key: "bedrooms", label: "Bedrooms" });
    if (newUnit.bathrooms === "") missing.push({ key: "bathrooms", label: "Bathrooms" });
    if (newUnit.designator && newUnit.designator !== "Whole" && !newUnit.number.trim()) {
      missing.push({ key: "number", label: "Unit number" });
    }
  }
  if (!lease.contactEmail.trim()) missing.push({ key: "contactEmail", label: "Contact email" });
  if (!lease.leaseTermMonths.length) missing.push({ key: "leaseTermMonths", label: "Lease length" });

  const missingKeys = new Set(missing.map((m) => m.key));
  // Fields are only marked once they have tried to publish — flagging an empty
  // form the moment it opens is noise.
  const [attempted, setAttempted] = useState(false);
  const flag = (key) =>
    attempted && missingKeys.has(key) ? "border-red-400 ring-1 ring-red-200" : "";

  const submit = async () => {
    if (missing.length) {
      setAttempted(true);
      const first = document.querySelector("[data-invalid='true']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      let res;
      if (unitMode === "existing") {
        // Nothing to create but the offering.
        res = await fetch("/api/leases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unitId: unit.id,
            rent: lease.rent === "" ? null : Number(lease.rent),
            rentIsPerPerson: lease.rentIsPerPerson,
            leaseTermMonths: lease.leaseTermMonths,
            sublease: lease.sublease,
            furnished: lease.furnished,
            available: true,
            availableFrom: lease.availableFrom || null,
            description: lease.description,
            contactEmail: lease.contactEmail,
            contactPhone: lease.contactPhone,
            contactName: user?.name ?? null,
          }),
        });
      } else {
        res = await fetch("/api/addListing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: place.address,
            longitude: place.longitude,
            latitude: place.latitude,
            lease_type: lease.sublease ? "Sublease" : "Standard",
            description: lease.description,
            furnished: lease.furnished,
            contactEmail: lease.contactEmail,
            contactPhone: lease.contactPhone,
            contactName: user?.name ?? null,
            // Attaching to a property we already hold rather than making a second one.
            ...(isKnownProperty ? { attachToListingId: place.property.id } : {}),
            unitTypes: [{
              bedrooms: Number(newUnit.bedrooms),
              bathrooms: Number(newUnit.bathrooms),
              area: newUnit.area === "" ? null : Number(newUnit.area),
              rent: lease.rent === "" ? null : Number(lease.rent),
              rentIsPerPerson: lease.rentIsPerPerson,
              // The lease's own start date. Sent per-unit because that is the
              // shape addListing writes leases from.
              leaseAvailability: lease.availableFrom || null,
              available: true,
              designator: newUnit.designator || null,
              number: newUnit.designator && newUnit.designator !== "Whole" ? newUnit.number : null,
              leaseTermMonths: lease.leaseTermMonths,
              sublease: lease.sublease,
            }],
          }),
        });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't publish that listing.");
      toast.success("Your listing is live.");
      const listingId = data.listing?.id ?? data.lease?.listingId ?? place.property?.id;
      /*
       * A landlord often has more than one offering on the same apartment —
       * a 10-month and a 12-month, or a sublease beside their own lease. Ending
       * on a choice rather than a redirect means the second one costs a form,
       * not the whole flow again.
       */
      setPublished({ listingId, unitId: unit?.id ?? null });
    } catch {
      toast.error("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    "w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none";

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900">List your place</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter property/lease information manually.
        </p>
      </div>

      <Section n={1} title="Where is it?" done={!!place}
        subtitle={place ? place.address : null}>
        <AddressStep value={place?.address} onResolved={(r) => {
          setPlace(r); setUnit(null); setUnitMode(null); advance("unit");
        }} />
      </Section>

      {showUnitStep && (
        <Section n={2} title="Which apartment?" done={unitResolved}
          subtitle={unit ? (unit.label ?? `${unit.bedrooms ?? "?"} bed · ${unit.bathrooms ?? "?"} bath`) : null}>
          {isKnownProperty && (
            <UnitStep
              property={place.property}
              units={place.units}
              selectedUnitId={unit?.id ?? null}
              onSelectUnit={chooseExisting}
              onAddNew={chooseNew}
            />
          )}

          {unitMode === "new" && (
            <div className={`grid gap-3 sm:grid-cols-3 ${isKnownProperty ? "mt-4 border-t border-gray-100 pt-4" : ""}`}>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">Unit type</span>
                <select className={field} value={newUnit.designator}
                  onChange={(e) => setNewUnit({ ...newUnit, designator: e.target.value })}>
                  <option value="">—</option>
                  {["Apt", "Unit", "Suite", "Floor", "Room", "Whole"].map((d) =>
                    <option key={d} value={d}>{d === "Whole" ? "Whole property" : d}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">Number</span>
                <input className={`${field} ${flag("number")}`}
                  data-invalid={attempted && missingKeys.has("number")}
                  value={newUnit.number}
                  disabled={!newUnit.designator || newUnit.designator === "Whole"}
                  placeholder="2W"
                  onChange={(e) => setNewUnit({ ...newUnit, number: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">Sq ft</span>
                <input type="number" min="0" className={field} value={newUnit.area}
                  onChange={(e) => setNewUnit({ ...newUnit, area: clampCount(e.target.value) })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Bedrooms <span className="text-red-500">*</span>
                </span>
                <input type="number" min="0" className={`${field} ${flag("bedrooms")}`}
                  data-invalid={attempted && missingKeys.has("bedrooms")}
                  value={newUnit.bedrooms}
                  onChange={(e) => setNewUnit({ ...newUnit, bedrooms: clampCount(e.target.value) })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Bathrooms <span className="text-red-500">*</span>
                </span>
                <input type="number" min="0" step="0.5" className={`${field} ${flag("bathrooms")}`}
                  data-invalid={attempted && missingKeys.has("bathrooms")}
                  value={newUnit.bathrooms}
                  onChange={(e) => setNewUnit({ ...newUnit, bathrooms: clampCount(e.target.value) })} />
              </label>
            </div>
          )}
        </Section>
      )}

      {showLeaseStep && (
        <Section n={3} title="Your terms" done={false}
          subtitle="What you're offering on this apartment">
          <LeaseStep
            unit={unit}
            existingLeases={unit?.leases ?? []}
            value={lease}
            onChange={setLease}
            invalid={attempted ? missingKeys : null}
          />
          {!published && (
          <button
            onClick={submit} disabled={submitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Publishing…" : "Publish listing"}
          </button>
          )}
          {published && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
              <p className="text-sm font-medium text-green-900">Your listing is live.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {published.unitId && (
                  <button
                    type="button"
                    onClick={() => {
                      // Same apartment, fresh terms. The unit stays chosen so
                      // only the offering has to be described again.
                      setLease(emptyLease(user?.email));
                      setAttempted(false);
                      setPublished(null);
                    }}
                    className="rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-green-800 ring-1 ring-green-300 hover:bg-green-100"
                  >
                    Add another listing on this unit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => router.push(published.listingId ? `/?listing=${published.listingId}` : "/dashboard/landlord")}
                  className="rounded-lg bg-green-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-green-800"
                >
                  View it
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/landlord?tab=properties")}
                  className="rounded-lg px-3.5 py-2 text-xs font-semibold text-green-800 hover:bg-green-100"
                >
                  Back to my properties
                </button>
              </div>
            </div>
          )}
          {attempted && missing.length > 0 && (
            <p className="mt-2 text-center text-xs font-medium text-red-600">
              Still needed: {missing.map((m) => m.label).join(", ")}
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
