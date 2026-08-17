// Final screen: everything as short statements with Change links, gaps
// called out in red, one Publish button. Mirrors
// apps/web/src/components/listings/wizard/StepReview.js.
import { Image, Pressable, Text, View } from "react-native";
import { AMENITY_LABELS, UTILITY_LABELS, LEASE_TERM_PRESETS } from "@proximity/shared";
import { Button } from "../../ui/Button";
import { StepFrame } from "./wizardShared";

const termLabel = (m) => LEASE_TERM_PRESETS.find((p) => p.months === m)?.label ?? `${m}-Month`;

function Row({ label, value, onPress, missing }) {
  return (
    <View className="flex-row items-start justify-between gap-4 border-b border-gray-100 py-3">
      <View className="flex-1">
        <Text className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</Text>
        {missing ? (
          <Text className="mt-0.5 text-sm font-medium text-red-600">{missing}</Text>
        ) : (
          <View className="mt-0.5">
            {typeof value === "string" ? <Text className="text-sm text-gray-800">{value}</Text> : value}
          </View>
        )}
      </View>
      <Pressable onPress={onPress}>
        <Text className="text-sm font-medium text-red-600">{missing ? "Add" : "Change"}</Text>
      </Pressable>
    </View>
  );
}

export default function StepReview({ w }) {
  const { form, units } = w;

  const unitLines = units.map((u, i) => {
    const bits = [];
    if (u.bedrooms !== "") bits.push(Number(u.bedrooms) === 0 ? "Studio" : `${u.bedrooms} bed`);
    if (u.bathrooms !== "") bits.push(`${u.bathrooms} bath`);
    bits.push(u.rent !== "" ? `$${u.rent}/mo` : "rent not set");
    const terms = (u.leaseTermMonths ?? []).map(termLabel).join(", ");
    return `${u.title ? `${u.title}: ` : ""}${bits.join(" · ")}${terms ? ` · ${terms}` : ""}${
      u.available === false ? " · not available" : ""
    }`;
  });

  const perks = [...form.amenities.map((a) => AMENITY_LABELS[a] ?? a), ...w.customAmenities];
  const photoCount = w.stagedImages.length;

  const unitsMissing =
    units.length === 0 || units.some((u) => u.bedrooms === "" || u.bathrooms === "")
      ? "Bedrooms and bathrooms needed"
      : units.some((u) => u.available !== false && !(u.leaseTermMonths ?? []).length)
      ? "Pick lease terms for each available unit"
      : null;

  return (
    <StepFrame title="Check everything looks right" subtitle="This is exactly what students will learn about your place.">
      <View className="rounded-xl border border-gray-200 px-4">
        <Row
          label="Address"
          value={form.address}
          missing={!form.address.trim() ? "Address needed" : null}
          onPress={() => w.goTo("address")}
        />
        <Row
          label="Basics"
          value={`${form.home_type.charAt(0).toUpperCase() + form.home_type.slice(1)}${
            form.furnished ? " · Furnished" : ""
          }${form.sublease_friendly ? " · Sublease friendly" : ""}${form.twenty_one_plus ? " · 21+" : ""}${
            form.move_in_date ? ` · Available from ${form.move_in_date}` : " · Available now"
          }`}
          onPress={() => w.goTo("basics")}
        />
        <Row
          label={`Units (${units.length})`}
          value={
            <View>
              {unitLines.map((line, i) => (
                <Text key={i} className="text-sm text-gray-800">
                  {line}
                </Text>
              ))}
            </View>
          }
          missing={unitsMissing}
          onPress={() => w.goTo("units")}
        />
        <Row
          label="Amenities & utilities"
          value={
            perks.length || form.utilities_included.length
              ? [
                  perks.join(", "),
                  form.utilities_included.length
                    ? `Includes ${form.utilities_included.map((u) => (UTILITY_LABELS[u] ?? u).toLowerCase()).join(", ")}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "None selected"
          }
          onPress={() => w.goTo("perks")}
        />
        <Row
          label="Photos"
          value={
            photoCount > 0 ? (
              <View className="flex-row items-center gap-1.5">
                {w.stagedImages.slice(0, 5).map((img) => (
                  <Image key={img.uri} source={{ uri: img.uri }} className="h-9 w-9 rounded border border-gray-200" />
                ))}
                <Text className="ml-1 text-xs text-gray-500">
                  {photoCount} photo{photoCount === 1 ? "" : "s"}
                </Text>
              </View>
            ) : (
              "No photos yet (you can add them after publishing)"
            )
          }
          onPress={() => w.goTo("photos")}
        />
        <Row
          label="Description"
          value={form.description.length > 140 ? `${form.description.slice(0, 140)}…` : form.description}
          missing={!form.description.trim() ? "A short description is needed" : null}
          onPress={() => w.goTo("description")}
        />
        <Row
          label="Contact"
          value={[form.contact_name, form.contact_email, form.contact_phone].filter(Boolean).join(" · ")}
          onPress={() => w.goTo("description")}
        />
      </View>

      <View className="mt-6">
        <Button onPress={w.publish} loading={w.submitting}>
          Publish listing
        </Button>
      </View>
    </StepFrame>
  );
}
