"use client";

import { useState } from "react";
import {
  AMENITY_OPTIONS,
  AMENITY_LABELS,
  UTILITY_OPTIONS,
  UTILITY_LABELS,
} from "@proximity/shared";
import { StepFrame, Chip, FieldLabel } from "@/components/listings/wizard/wizardShared";

// Screen 4: amenities + included utilities. All chips, all optional.
export default function StepPerks({ w }) {
  const [customInput, setCustomInput] = useState("");

  const addCustom = () => {
    w.addCustomAmenity(customInput);
    setCustomInput("");
  };

  return (
    <StepFrame
      title="What does it come with?"
      subtitle="Tap everything that applies. Skip anything you're not sure about."
    >
      <div className="flex flex-wrap gap-2">
        {AMENITY_OPTIONS.map((a) => (
          <Chip
            key={a}
            on={w.form.amenities.includes(a)}
            onClick={() => w.toggleMulti("amenities", a)}
          >
            {AMENITY_LABELS[a]}
          </Chip>
        ))}
        {w.customAmenities.map((a) => (
          <Chip key={a} on onClick={() => w.removeCustomAmenity(a)}>
            {a} ×
          </Chip>
        ))}
      </div>
      <div className="mt-3 flex max-w-sm items-center gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Something else? Type and press Enter"
          className="flex-1 rounded-full border border-gray-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      </div>

      <div className="mt-7">
        <FieldLabel>Utilities included in rent</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {UTILITY_OPTIONS.map((u) => (
            <Chip
              key={u}
              on={w.form.utilities_included.includes(u)}
              onClick={() => w.toggleMulti("utilities_included", u)}
            >
              {UTILITY_LABELS[u]}
            </Chip>
          ))}
        </div>
      </div>
    </StepFrame>
  );
}
