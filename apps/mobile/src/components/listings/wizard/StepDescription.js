// Screen 6: words + contact. An empty description arrives pre-drafted from
// the answers already given (facts only, nothing invented), for the
// landlord to make their own. Mirrors
// apps/web/src/components/listings/wizard/StepDescription.js.
import { useEffect, useRef } from "react";
import { TextInput, View } from "react-native";
import { AMENITY_LABELS, UTILITY_LABELS } from "@proximity/shared";
import { TextField } from "../../ui/TextField";
import { FieldLabel, StepFrame } from "./wizardShared";

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

  const perks = [...form.amenities.map((a) => AMENITY_LABELS[a] ?? a), ...customAmenities];
  if (perks.length) {
    parts.push(`Features ${perks.slice(0, 6).join(", ").toLowerCase()}${perks.length > 6 ? ", and more" : ""}.`);
  }
  if (form.utilities_included.length) {
    parts.push(`Rent includes ${form.utilities_included.map((u) => (UTILITY_LABELS[u] ?? u).toLowerCase()).join(", ")}.`);
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
    <StepFrame title="Describe it in your words" subtitle="We started a draft from your answers. Make it sound like you.">
      <FieldLabel>Description</FieldLabel>
      <TextInput
        value={w.form.description}
        onChangeText={(v) => w.setField("description", v)}
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        placeholder="What makes this place great for students?"
        placeholderTextColor="#9ca3af"
        className="min-h-28 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base text-gray-900"
      />

      <TextField
        className="mt-5"
        label="Display name"
        value={w.form.title}
        onChangeText={(v) => w.setField("title", v)}
        placeholder='e.g. "Cozy 2BR near the Loop"'
      />

      <View className="mt-6">
        <FieldLabel>Contact info students will see</FieldLabel>
        <View className="gap-3">
          <TextField label="Name" value={w.form.contact_name} onChangeText={(v) => w.setField("contact_name", v)} />
          <TextField
            label="Email"
            value={w.form.contact_email}
            onChangeText={(v) => w.setField("contact_email", v)}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextField
            label="Phone"
            value={w.form.contact_phone}
            onChangeText={(v) => w.setField("contact_phone", v)}
            keyboardType="phone-pad"
          />
        </View>
      </View>
    </StepFrame>
  );
}
