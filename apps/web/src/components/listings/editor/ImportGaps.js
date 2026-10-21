"use client";

import { AlertTriangle, ChevronRight } from "lucide-react";

/*
 * What a draft is still missing, as a list of things to click.
 *
 * An import fills what the website states and leaves the rest blank, and a
 * blank box in a long editor is easy to miss: a lease with no length cannot
 * be published usefully, a unit with no price shows "Contact for pricing".
 * This box sits at the top of the draft (on the import workspace and on the
 * dashboard's draft view) and names each gap. Clicking one opens the unit
 * concerned and scrolls to the field, which the editors mark with a
 * data-gap attribute. See focusGap() and the listener in EditorUnits.
 */

export const FOCUS_EVENT = "proximity:focus-field";

/* Open the unit (if any) and scroll to the field. */
export function focusGap(target, unitId = null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { target, unitId } }));
}

/* Scroll to and briefly highlight a marked field. Used by the listeners. */
export function revealGap(target) {
  const el = document.querySelector(`[data-gap="${CSS.escape(target)}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el.matches("input,textarea,select,button") ? el : el.querySelector("input,textarea,select");
  focusable?.focus?.({ preventScroll: true });
  el.classList.add("ring-2", "ring-amber-400", "ring-offset-2", "rounded-md");
  setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2", "rounded-md"), 2500);
  return true;
}

const label = (u, i) => u.name ?? `${u.bedrooms ?? "?"} bed / ${u.bathrooms ?? "?"} bath${i != null ? ` (${i + 1})` : ""}`;

/*
 * The gaps, in the order a landlord should fix them. Each is
 * { key, title, items: [{ text, target, unitId }] }.
 */
export function findGaps(listing) {
  const units = listing?.unitTypes ?? [];
  const mine = (u) => (u.leases ?? []).filter((l) => l.mine !== false);
  const gaps = [];
  const add = (key, title, items) => {
    if (items.length) gaps.push({ key, title, items });
  };

  add(
    "price",
    "Price",
    units.flatMap((u, i) => {
      const leases = mine(u);
      if (!leases.length) return [{ text: `${label(u, i)}: no lease yet`, target: `unit:${u.id}`, unitId: u.id }];
      return leases.filter((l) => l.rent == null).map((l) => ({ text: `${label(u, i)}: no rent`, target: `rent:${l.id}`, unitId: u.id }));
    })
  );
  add(
    "terms",
    "Lease lengths",
    units.flatMap((u, i) => mine(u).filter((l) => !(l.leaseTermMonths ?? []).length).map((l) => ({ text: label(u, i), target: `terms:${l.id}`, unitId: u.id })))
  );
  add(
    "availability",
    "Availability date (shows as available now)",
    // A lease the import marked "Available now" has its date: the site said so.
    units.flatMap((u, i) => mine(u).filter((l) => !l.availableFrom && !/^Available now\b/.test(l.description ?? "")).map((l) => ({ text: label(u, i), target: `date:${l.id}`, unitId: u.id })))
  );
  add(
    "photos",
    "Photos",
    (listing?.photos ?? []).length ? [] : [{ text: "No photos of the property", target: "photos", unitId: null }]
  );
  add(
    "floorplans",
    "Floor plan diagram",
    units.filter((u) => !u.floorPlanImageUrl).map((u, i) => ({ text: label(u, i), target: `floorplan:${u.id}`, unitId: u.id }))
  );
  add(
    "description",
    "Description",
    String(listing?.description ?? "").trim() ? [] : [{ text: "No description", target: "description", unitId: null }]
  );
  add(
    "utilities",
    "Utilities included (none selected)",
    (listing?.utilitiesIncluded ?? []).length ? [] : [{ text: "Tick any utilities the rent covers", target: "utilities", unitId: null }]
  );
  add(
    "contact",
    "Contact email",
    String(listing?.contactEmail ?? "").trim() ? [] : [{ text: "No contact email", target: "contact", unitId: null }]
  );
  return gaps;
}

const CHIP_CAP = 10;

export default function ImportGaps({ listing }) {
  const gaps = findGaps(listing);
  if (!gaps.length) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Every important field has a value. Check them, then publish.
      </div>
    );
  }
  const total = gaps.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        {total} thing{total === 1 ? "" : "s"} the website did not say
      </p>
      <p className="mt-0.5 text-xs text-gray-600">Click one to jump to the field and fill it in.</p>
      <ul className="mt-3 space-y-2">
        {gaps.map((g) => (
          <li key={g.key} className="text-sm">
            <span className="font-medium text-gray-800">{g.title}</span>
            <span className="ml-1 text-xs text-gray-500">({g.items.length})</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {g.items.slice(0, CHIP_CAP).map((it, i) => (
                <button
                  key={`${it.target}-${i}`}
                  type="button"
                  onClick={() => focusGap(it.target, it.unitId)}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs text-gray-800 hover:border-red-400 hover:text-red-700"
                >
                  {it.text}
                  <ChevronRight className="h-3 w-3 text-gray-400" />
                </button>
              ))}
              {g.items.length > CHIP_CAP && (
                <span className="self-center text-xs text-gray-500">+{g.items.length - CHIP_CAP} more</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
