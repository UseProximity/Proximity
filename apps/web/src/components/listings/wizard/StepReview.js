"use client";

import {
  AMENITY_LABELS,
  UTILITY_LABELS,
  LEASE_TERM_PRESETS,
} from "@/components/listings/listingFormOptions";
import { StepFrame } from "@/components/listings/wizard/wizardShared";
import { parseUnitNames } from "@/utils/unitName";

const termLabel = (m) =>
  LEASE_TERM_PRESETS.find((p) => p.months === m)?.label ?? `${m}-Month`;

function Row({ label, value, onChange, missing }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {label}
        </p>
        {missing ? (
          <p className="mt-0.5 text-sm font-medium text-red-600">{missing}</p>
        ) : (
          <div className="mt-0.5 text-sm text-gray-800">{value}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 text-sm font-medium text-red-600 hover:underline"
      >
        {missing ? "Add" : "Change"}
      </button>
    </div>
  );
}

/*
 * Final screen: GOV.UK-style "check your answers" — everything as short
 * statements with Change links, gaps called out in red, one Publish button.
 */
export default function StepReview({ w }) {
  const { form, units } = w;

  const unitLines = units.map((u, i) => {
    const bits = [];
    if (u.bedrooms !== "") bits.push(Number(u.bedrooms) === 0 ? "Studio" : `${u.bedrooms} bed`);
    if (u.bathrooms !== "") bits.push(`${u.bathrooms} bath`);
    bits.push(u.rent !== "" ? `$${u.rent}/mo` : "rent not set");
    const terms = (u.leaseTermMonths ?? []).map(termLabel).join(", ");
    return (
      <p key={i}>
        {u.unitNames?.trim() ? `${parseUnitNames(u.unitNames).join(", ")}: ` : ""}
        {bits.join(" · ")}
        {terms ? ` · ${terms}` : ""}
        {u.floorPlanImageUrl ? " · floor plan ✓" : ""}
        {u.available === false ? " · not available" : ""}
      </p>
    );
  });

  const perks = [
    ...form.amenities.map((a) => AMENITY_LABELS[a] ?? a),
    ...w.customAmenities,
  ];
  const photoCount =
    w.stagedPreviews.length +
    (w.streetView.available && !w.streetViewDeleted ? 1 : 0);

  const unitsMissing =
    units.length === 0 ||
    units.some((u) => u.bedrooms === "" || u.bathrooms === "")
      ? "Bedrooms and bathrooms needed"
      : units.some(
          (u) =>
            u.available !== false && !(u.leaseTermMonths ?? []).length
        )
      ? "Pick lease terms for each available unit"
      : null;

  return (
    <StepFrame
      title="Check everything looks right"
      subtitle={
        w.importInfo?.host
          ? `Anything highlighted came from ${w.importInfo.host}. This is the moment to catch mistakes.`
          : "This is exactly what students will learn about your place."
      }
    >
      <div className="rounded-xl border border-gray-200 px-4">
        <Row
          label="Address"
          value={form.address}
          missing={!form.address.trim() ? "Address needed" : null}
          onChange={() => w.goTo("address")}
        />
        <Row
          label="Basics"
          value={`${
            form.home_type.charAt(0).toUpperCase() + form.home_type.slice(1)
          }${form.furnished ? " · Furnished" : ""}${
            form.sublease_friendly ? " · Sublease friendly" : ""
          }${form.twenty_one_plus ? " · 21+" : ""}${
            form.move_in_date
              ? ` · Available from ${form.move_in_date}`
              : " · Available now"
          }`}
          onChange={() => w.goTo("basics")}
        />
        <Row
          label={`Units (${units.length})`}
          value={<div className="space-y-0.5">{unitLines}</div>}
          missing={unitsMissing}
          onChange={() => w.goTo("units")}
        />
        <Row
          label="Amenities & utilities"
          value={
            perks.length || form.utilities_included.length
              ? [
                  perks.join(", "),
                  form.utilities_included.length
                    ? `Includes ${form.utilities_included
                        .map((u) => (UTILITY_LABELS[u] ?? u).toLowerCase())
                        .join(", ")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "None selected"
          }
          onChange={() => w.goTo("perks")}
        />
        <Row
          label="Photos"
          value={
            photoCount > 0 ? (
              <div className="flex items-center gap-1.5">
                {w.stagedPreviews.slice(0, 5).map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt=""
                    className="h-9 w-9 rounded object-cover border border-gray-200"
                  />
                ))}
                <span className="ml-1 text-xs text-gray-500">
                  {photoCount} photo{photoCount === 1 ? "" : "s"}
                </span>
              </div>
            ) : (
              "No photos yet (you can add them after publishing)"
            )
          }
          onChange={() => w.goTo("photos")}
        />
        <Row
          label="Description"
          value={
            form.description.length > 140
              ? `${form.description.slice(0, 140)}…`
              : form.description
          }
          missing={!form.description.trim() ? "A short description is needed" : null}
          onChange={() => w.goTo("description")}
        />
        <Row
          label="Contact"
          value={[form.contact_name, form.contact_email, form.contact_phone]
            .filter(Boolean)
            .join(" · ")}
          onChange={() => w.goTo("description")}
        />
      </div>

      {w.importInfo?.notes?.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-900">
            Notes from reading your website:
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-800">
            {w.importInfo.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
        * Two buttons, same listing, same checks: one puts it in front of
        * students now, the other keeps it on the dashboard until it is
        * published from there. An import leads with the draft (Wyatt,
        * 2026-10-16): what a website or PMS said about a building deserves a
        * read-through, and the Drafts page publishes the complete ones in one
        * click. Typed-in listings lead with Publish.
        */}
      {(() => {
        const imported = !!w.importInfo || (w.importedFields?.size ?? 0) > 0;
        const primary =
          "mt-6 w-full rounded-lg bg-red-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60";
        const secondary =
          "mt-2 w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 transition-colors hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-60";
        const publishBtn = (cls) => (
          <button key="publish" type="button" onClick={() => w.publish(false)} disabled={!!w.submitting} className={cls}>
            {w.submitting === "publish" ? "Publishing…" : imported ? "Publish now" : "Publish listing"}
          </button>
        );
        const draftBtn = (cls) => (
          <button key="draft" type="button" onClick={() => w.publish(true)} disabled={!!w.submitting} className={cls}>
            {w.submitting === "draft" ? "Saving…" : "Save as draft"}
          </button>
        );
        return imported
          ? [draftBtn(primary), publishBtn(secondary)]
          : [publishBtn(primary), draftBtn(secondary)];
      })()}
      <p className="mt-2 text-center text-xs text-gray-500">
        A draft is only on your dashboard until you publish it.
      </p>
      {w.importQueue.length > 0 && (
        <p className="mt-2 text-center text-xs text-gray-500">
          Up next: {w.importQueue[0].name} ({w.importQueue.length} more to go)
        </p>
      )}
    </StepFrame>
  );
}
