"use client";

import { HOME_TYPES } from "@/components/listings/listingFormOptions";
import { StepFrame, Chip, FieldLabel, inputCls, importedInputCls } from "@/components/listings/wizard/wizardShared";

// Screen 2: what kind of place. Chips and toggles only — the availability ask
// costs one tap ("Available now" is pre-selected) but is a conscious choice,
// because matchmaking needs a move-in signal on every listing.
export default function StepBasics({ w }) {
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
      </div>
    </StepFrame>
  );
}
