"use client";

import { useEffect, useRef } from "react";
import {
  AMENITY_LABELS,
  UTILITY_LABELS,
} from "@/components/listings/listingFormOptions";
import {
  StepFrame,
  FieldLabel,
  inputCls,
  importedInputCls,
} from "@/components/listings/wizard/wizardShared";

/*
 * Screen 6: words + contact. Research says never show a blank textarea — so an
 * empty description arrives pre-drafted from the answers already given
 * (facts only, nothing invented), for the landlord to make their own.
 */
function draftDescription(form, units, customAmenities) {
  const street = (form.address || "").split(",")[0].trim();
  const parts = [];

  const unitBits = units
    .filter((u) => u.bedrooms !== "" && u.bedrooms != null)
    .map((u) => {
      const beds = Number(u.bedrooms);
      const baths = u.bathrooms !== "" && u.bathrooms != null ? Number(u.bathrooms) : null;
      const bed = beds === 0 ? "studio" : `${beds}-bedroom`;
      return baths ? `${bed}, ${baths}-bath` : bed;
    });
  const homeType = form.home_type === "other" ? "home" : form.home_type;
  if (unitBits.length) {
    const uniq = [...new Set(unitBits)];
    parts.push(
      `${form.furnished ? "Furnished " : ""}${uniq.join(" and ")} ${homeType}${
        uniq.length > 1 ? " units" : ""
      }${street ? ` at ${street}` : ""}.`
    );
  } else if (street) {
    parts.push(`${form.furnished ? "Furnished " : ""}${homeType} at ${street}.`);
  }

  const perks = [
    ...form.amenities.map((a) => AMENITY_LABELS[a] ?? a),
    ...customAmenities,
  ];
  if (perks.length) {
    parts.push(
      `Features ${perks.slice(0, 6).join(", ").toLowerCase()}${
        perks.length > 6 ? ", and more" : ""
      }.`
    );
  }
  if (form.utilities_included.length) {
    parts.push(
      `Rent includes ${form.utilities_included
        .map((u) => (UTILITY_LABELS[u] ?? u).toLowerCase())
        .join(", ")}.`
    );
  }
  return parts.join(" ");
}

export default function StepDescription({ w }) {
  // Draft once, only into an empty box, and remember we did — so a landlord
  // who deletes the draft on purpose doesn't get it forced back.
  const draftedRef = useRef(false);
  useEffect(() => {
    if (draftedRef.current) return;
    draftedRef.current = true;
    if (!w.form.description.trim()) {
      const draft = draftDescription(w.form, w.units, w.customAmenities);
      if (draft) w.setField("description", draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StepFrame
      title="Describe it in your words"
      subtitle="We started a draft from your answers. Make it sound like you."
    >
      <textarea
        value={w.form.description}
        onChange={(e) => w.setField("description", e.target.value)}
        rows={5}
        className={`${inputCls}${
          w.importedFields.has("description") ? importedInputCls : ""
        }`}
        placeholder="What makes this place great for students?"
      />

      <div className="mt-5 max-w-sm">
        <FieldLabel optional>Display name</FieldLabel>
        <input
          value={w.form.title}
          onChange={(e) => w.setField("title", e.target.value)}
          placeholder='e.g. "Cozy 2BR near the Loop"'
          className={`${inputCls}${
            w.importedFields.has("title") ? importedInputCls : ""
          }`}
        />
      </div>

      <div className="mt-7">
        <FieldLabel>Contact info students will see</FieldLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { name: "contact_name", label: "Name", type: "text" },
            { name: "contact_email", label: "Email", type: "email" },
            { name: "contact_phone", label: "Phone", type: "text" },
          ].map(({ name, label, type }) => (
            <input
              key={name}
              type={type}
              value={w.form[name]}
              onChange={(e) => w.setField(name, e.target.value)}
              placeholder={label}
              className={`${inputCls}${
                w.importedFields.has(name) ? importedInputCls : ""
              }`}
            />
          ))}
        </div>
      </div>
    </StepFrame>
  );
}
