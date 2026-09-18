"use client";

import { HOME_TYPES } from "@/components/listings/listingFormOptions";
import { StepFrame, Chip, FieldLabel, inputCls, importedInputCls } from "@/components/listings/wizard/wizardShared";

// Screen 2: what kind of place. Chips and toggles only — the availability ask
// costs one tap ("Available now" is pre-selected) but is a conscious choice,
// because matchmaking needs a move-in signal on every listing.
export default function StepBasics({ w }) {
  /*
   * Is availability already answered one floor down?
   *
   * This asks for the whole property, and the units step asks per apartment,
   * so a landlord who meets both reasonably wonders which one counts. It used
   * to hide only when every apartment carried a DATE — which meant a building
   * whose apartments are all available now still got asked here, because "now"
   * is stored as a blank date. Blank is an answer on that step (it shows a
   * green "Available now" beside every apartment), so it is an answer for this
   * one too.
   *
   * An apartment we read off the landlord's own website therefore counts as
   * answered. A waitlisted floor plan is not offered at all, so it has no say.
   * What is left asking is the case this question was written for: someone
   * typing in one place by hand, with no apartment numbers and no date.
   */
  const offered = (w.units ?? []).filter((u) => u.available !== false);
  const unitDateState = offered.map((u) => {
    const numbers = String(u.unitNumbers ?? "")
      .split(/[,\s]+/)
      .filter(Boolean);
    if (!numbers.length) return !!u.availableFrom;
    return true;
  });
  const datedPerUnit = unitDateState.length > 0 && unitDateState.every(Boolean);
  const anyUnitDated = unitDateState.some(Boolean);
  return (
    <StepFrame
      title="What kind of place is it?"
      subtitle="No wrong answers. You can change any of this later."
    >
      <div className="flex flex-wrap gap-2">
        {HOME_TYPES.map((t) => (
          <Chip
            key={t}
            on={w.form.home_type === t}
            onClick={() => w.setField("home_type", t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Chip>
        ))}
      </div>

      <div className="mt-6">
        <FieldLabel>Anything students should know?</FieldLabel>
        <div className="flex flex-wrap gap-2">
          <Chip
            on={w.form.furnished}
            onClick={() => w.setField("furnished", !w.form.furnished)}
          >
            Furnished
          </Chip>
          <Chip
            on={w.form.sublease_friendly}
            onClick={() => w.setField("sublease_friendly", !w.form.sublease_friendly)}
          >
            Sublease friendly
          </Chip>
          <Chip
            on={w.form.twenty_one_plus}
            onClick={() => w.setField("twenty_one_plus", !w.form.twenty_one_plus)}
          >
            21+ only
          </Chip>
        </div>
      </div>

      {/*
        Availability belongs to the lease, not the building. The units step
        collects a date per apartment, so once every apartment has one this
        question is not just redundant, it invites a landlord to contradict
        themselves on a building where apartments free up on different days.
        It stays for the ordinary case (a house, or apartments that are all
        available together) and as the fallback the API applies to any
        apartment without its own date.
      */}
      {datedPerUnit ? (
        <div className="mt-6 rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-medium text-gray-700">Availability</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Set per apartment on the Units and rent step, which is where your
            website listed it. Nothing to answer here.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <FieldLabel>When is it available?</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              on={w.availabilityMode === "now"}
              onClick={() => {
                w.setAvailabilityMode("now");
                w.setField("move_in_date", "");
              }}
            >
              Available now
            </Chip>
            <Chip
              on={w.availabilityMode === "date"}
              onClick={() => w.setAvailabilityMode("date")}
            >
              From a date
            </Chip>
            {w.availabilityMode === "date" && (
              <input
                type="date"
                value={w.form.move_in_date}
                onChange={(e) => w.setField("move_in_date", e.target.value)}
                autoFocus
                className={`${inputCls} w-44${
                  w.importedFields.has("move_in_date") ? importedInputCls : ""
                }`}
              />
            )}
          </div>
          {anyUnitDated && (
            <p className="mt-1.5 text-[11px] text-gray-500">
              Some apartments already have their own date on the Units step.
              This one covers the rest.
            </p>
          )}
        </div>
      )}
    </StepFrame>
  );
}
