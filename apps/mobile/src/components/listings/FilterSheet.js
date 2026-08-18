// Mobile-idiomatic filter sheet: a full-screen modal with a draft copy of
// filters that only commits on "Apply" (mirrors web's mobileDraft pattern
// in AvailableListings.js), simple chips/switches instead of web's sliders.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import {
  DEFAULT_FILTERS,
  HOME_TYPE_FILTER_OPTIONS,
  HOME_TYPE_FILTER_LABELS,
  LEASE_AVAILABILITY_FILTER_OPTIONS,
  LEASE_AVAILABILITY_FILTER_LABELS,
  FILTER_AMENITY_OPTIONS,
  FILTER_AMENITY_LABELS,
  UTILITY_OPTIONS,
  UTILITY_LABELS,
} from "@proximity/shared";
import { Section } from "../ui/Section";
import { Chip } from "../ui/Chip";

function ChipGroup({ options, labels, value, onChange }) {
  function toggle(option) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  }
  return (
    <View className="flex-row flex-wrap">
      {options.map((option) => (
        <Chip key={option} on={value.includes(option)} onPress={() => toggle(option)}>
          {labels[option] ?? option}
        </Chip>
      ))}
    </View>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <View className="flex-row bg-gray-100 rounded-lg p-1">
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          className={`flex-1 items-center py-2 rounded-md ${value === opt.value ? "bg-white" : ""}`}
        >
          <Text className={`text-xs font-medium ${value === opt.value ? "text-gray-900" : "text-gray-500"}`}>
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function NumberField({ placeholder, value, onChangeText }) {
  return (
    <TextInput
      className="flex-1 h-11 border border-gray-200 rounded-lg px-3 text-sm"
      placeholder={placeholder}
      keyboardType="numeric"
      value={value}
      onChangeText={onChangeText}
    />
  );
}

export function FilterSheet({ visible, filters, onApply, onClose }) {
  const [draft, setDraft] = useState(filters);

  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  function set(key, val) {
    setDraft((d) => ({ ...d, [key]: val }));
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white pt-14">
        <View className="flex-row items-center justify-between px-4 pb-3 border-b border-gray-100">
          <Pressable onPress={() => setDraft(DEFAULT_FILTERS)}>
            <Text className="text-gray-500 text-sm">Reset</Text>
          </Pressable>
          <Text className="text-base font-bold text-gray-900">Filters</Text>
          <Pressable onPress={onClose}>
            <Text className="text-gray-500 text-sm">Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Section title="Price">
            <View className="flex-row gap-2.5">
              <NumberField placeholder="Min rent" value={draft.minRent} onChangeText={(v) => set("minRent", v)} />
              <NumberField placeholder="Max rent" value={draft.maxRent} onChangeText={(v) => set("maxRent", v)} />
            </View>
          </Section>

          <Section title="Bedrooms">
            <View className="flex-row gap-2.5">
              <NumberField placeholder="Min beds" value={draft.bedrooms} onChangeText={(v) => set("bedrooms", v)} />
              <NumberField placeholder="Max beds" value={draft.maxBedrooms} onChangeText={(v) => set("maxBedrooms", v)} />
            </View>
          </Section>

          <Section title="Bathrooms">
            <View className="flex-row gap-2.5">
              <NumberField placeholder="Min baths" value={draft.bathrooms} onChangeText={(v) => set("bathrooms", v)} />
              <NumberField placeholder="Max baths" value={draft.maxBathrooms} onChangeText={(v) => set("maxBathrooms", v)} />
            </View>
          </Section>

          <Section title="Home Type">
            <ChipGroup
              options={HOME_TYPE_FILTER_OPTIONS}
              labels={HOME_TYPE_FILTER_LABELS}
              value={draft.homeType}
              onChange={(v) => set("homeType", v)}
            />
          </Section>

          <Section title="Lease Availability">
            <ChipGroup
              options={LEASE_AVAILABILITY_FILTER_OPTIONS}
              labels={LEASE_AVAILABILITY_FILTER_LABELS}
              value={draft.leaseAvailability}
              onChange={(v) => set("leaseAvailability", v)}
            />
          </Section>

          <Section title="Amenities">
            <ChipGroup
              options={FILTER_AMENITY_OPTIONS}
              labels={FILTER_AMENITY_LABELS}
              value={draft.amenities}
              onChange={(v) => set("amenities", v)}
            />
          </Section>

          <Section title="Utilities Included">
            <ChipGroup
              options={UTILITY_OPTIONS}
              labels={UTILITY_LABELS}
              value={draft.utilitiesIncluded}
              onChange={(v) => set("utilitiesIncluded", v)}
            />
          </Section>

          <Section title="Furnished">
            <SegmentedControl
              options={[
                { value: "", label: "Any" },
                { value: "furnished", label: "Furnished" },
                { value: "unfurnished", label: "Unfurnished" },
              ]}
              value={draft.furnished}
              onChange={(v) => set("furnished", v)}
            />
          </Section>

          <Section title="Lease Structure">
            <SegmentedControl
              options={[
                { value: "", label: "Any" },
                { value: "individual", label: "Individual" },
                { value: "joint", label: "Joint" },
              ]}
              value={draft.leaseStructure}
              onChange={(v) => set("leaseStructure", v)}
            />
          </Section>

          <Section title="Walking distance">
            <View className="flex-row gap-2.5">
              <NumberField placeholder="Min. to campus" value={draft.distance} onChangeText={(v) => set("distance", v)} />
              <NumberField
                placeholder="Min. to shuttle"
                value={draft.distanceToShuttle}
                onChangeText={(v) => set("distanceToShuttle", v)}
              />
            </View>
          </Section>

          <Section title="Move-in date">
            <TextInput
              className="h-11 border border-gray-200 rounded-lg px-3 text-sm"
              placeholder="YYYY-MM-DD"
              value={draft.moveInDate}
              onChangeText={(v) => set("moveInDate", v)}
            />
          </Section>

          <View className="flex-row items-center justify-between py-2">
            <Text className="text-sm text-gray-700">Sublease-friendly only</Text>
            <Switch value={draft.subleaseFriendly} onValueChange={(v) => set("subleaseFriendly", v)} />
          </View>
          <View className="flex-row items-center justify-between py-2 mb-4">
            <Text className="text-sm text-gray-700">Subleases only</Text>
            <Switch value={draft.subleaseOnly} onValueChange={(v) => set("subleaseOnly", v)} />
          </View>
        </ScrollView>

        <View className="p-4 border-t border-gray-100">
          <Pressable onPress={() => onApply(draft)} className="h-12 rounded-lg bg-red-600 items-center justify-center">
            <Text className="text-white font-semibold text-sm">Apply Filters</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
