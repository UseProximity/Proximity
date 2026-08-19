// Mobile-idiomatic filter sheet: a full-screen modal with a draft copy of
// filters that only commits on "Apply" (mirrors web's mobileDraft pattern
// in AvailableListings.js), simple chips/switches instead of web's sliders.
//
// Visual-polish pass (design-system Stage I): the 11 original sections were
// all identically weighted (same bold title, same spacing), which read as
// flat and cluttered. Regrouped into 4 visually distinct clusters below —
// every field/key/option list is untouched, only how they're grouped and
// styled changed.
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import {
  X,
  DollarSign,
  Building2,
  Tag,
  MapPin,
  PawPrint,
  Flame,
  Dumbbell,
  BookOpen,
  WavesHorizontal,
  WashingMachine,
  Thermometer,
  Mail,
  Package,
  Car,
  Zap,
  Droplets,
  Wifi,
  Trash2,
  Tv,
  Wind,
} from "lucide-react-native";
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
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { SectionHeader } from "../ui/SectionHeader";
import { FieldLabel } from "../ui/FieldLabel";
import { colors } from "../../theme/tokens";

// Icons only where one genuinely aids recognition — not every option gets
// one. Home Type/Lease Availability/Lease Structure stay text-only: their
// options ("Condo" vs "Townhouse", "Individual" vs "Joint") don't have
// visually distinct enough line-icon equivalents to actually help. A few
// amenities/utilities (dishwasher, sewer) have no clean 1:1 icon either and
// stay text-only rather than force a weak/confusing one.
const AMENITY_ICONS = {
  pets_allowed: PawPrint,
  fireplace: Flame,
  gym: Dumbbell,
  study_room: BookOpen,
  pool: WavesHorizontal,
  in_unit_laundry: WashingMachine,
  ac_heating: Thermometer,
  mailroom: Mail,
  extra_storage: Package,
  private_parking: Car,
};

const UTILITY_ICONS = {
  electric: Zap,
  gas: Flame,
  heat: Thermometer,
  water: Droplets,
  internet: Wifi,
  trash: Trash2,
  cable: Tv,
  cooling: Wind,
};

function ChipGroup({ options, labels, value, onChange, icons }) {
  function toggle(option) {
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  }
  return (
    <View className="flex-row flex-wrap">
      {options.map((option) => (
        <Chip
          key={option}
          on={value.includes(option)}
          onPress={() => toggle(option)}
          icon={icons?.[option]}
          showCheck={!icons}
        >
          {labels[option] ?? option}
        </Chip>
      ))}
    </View>
  );
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <View className="flex-row bg-gray-100 rounded-full p-1">
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          className={`flex-1 items-center py-2 rounded-full ${value === opt.value ? "bg-red-600" : ""}`}
        >
          <Text className={`text-xs font-semibold ${value === opt.value ? "text-white" : "text-gray-500"}`}>
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
      className="flex-1 h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white"
      placeholder={placeholder}
      placeholderTextColor="#9ca3af"
      keyboardType="numeric"
      value={value}
      onChangeText={onChangeText}
    />
  );
}

function ToggleRow({ label, value, onValueChange }) {
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="text-sm text-gray-700">{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.white}
      />
    </View>
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
          <Text className="text-lg font-bold text-gray-900">Filters</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
            className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
          >
            <X size={18} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View className="bg-gray-50 rounded-2xl p-4 mb-4">
            <SectionHeader icon={DollarSign} title="Budget & Size" />
            <View className="mb-3">
              <FieldLabel>Price</FieldLabel>
              <View className="flex-row gap-2.5">
                <NumberField placeholder="Min rent" value={draft.minRent} onChangeText={(v) => set("minRent", v)} />
                <NumberField placeholder="Max rent" value={draft.maxRent} onChangeText={(v) => set("maxRent", v)} />
              </View>
            </View>
            <View className="mb-3">
              <FieldLabel>Bedrooms</FieldLabel>
              <View className="flex-row gap-2.5">
                <NumberField placeholder="Min beds" value={draft.bedrooms} onChangeText={(v) => set("bedrooms", v)} />
                <NumberField
                  placeholder="Max beds"
                  value={draft.maxBedrooms}
                  onChangeText={(v) => set("maxBedrooms", v)}
                />
              </View>
            </View>
            <View>
              <FieldLabel>Bathrooms</FieldLabel>
              <View className="flex-row gap-2.5">
                <NumberField
                  placeholder="Min baths"
                  value={draft.bathrooms}
                  onChangeText={(v) => set("bathrooms", v)}
                />
                <NumberField
                  placeholder="Max baths"
                  value={draft.maxBathrooms}
                  onChangeText={(v) => set("maxBathrooms", v)}
                />
              </View>
            </View>
          </View>

          <View className="bg-gray-50 rounded-2xl p-4 mb-4">
            <SectionHeader icon={Building2} title="Property" />
            <View className="mb-3">
              <FieldLabel>Home Type</FieldLabel>
              <ChipGroup
                options={HOME_TYPE_FILTER_OPTIONS}
                labels={HOME_TYPE_FILTER_LABELS}
                value={draft.homeType}
                onChange={(v) => set("homeType", v)}
              />
            </View>
            <View className="mb-3">
              <FieldLabel>Furnished</FieldLabel>
              <SegmentedControl
                options={[
                  { value: "", label: "Any" },
                  { value: "furnished", label: "Furnished" },
                  { value: "unfurnished", label: "Unfurnished" },
                ]}
                value={draft.furnished}
                onChange={(v) => set("furnished", v)}
              />
            </View>
            <View className="mb-3">
              <FieldLabel>Lease Availability</FieldLabel>
              <ChipGroup
                options={LEASE_AVAILABILITY_FILTER_OPTIONS}
                labels={LEASE_AVAILABILITY_FILTER_LABELS}
                value={draft.leaseAvailability}
                onChange={(v) => set("leaseAvailability", v)}
              />
            </View>
            <View className="mb-3">
              <FieldLabel>Lease Structure</FieldLabel>
              <SegmentedControl
                options={[
                  { value: "", label: "Any" },
                  { value: "individual", label: "Individual" },
                  { value: "joint", label: "Joint" },
                ]}
                value={draft.leaseStructure}
                onChange={(v) => set("leaseStructure", v)}
              />
            </View>
            <ToggleRow
              label="Sublease-friendly only"
              value={draft.subleaseFriendly}
              onValueChange={(v) => set("subleaseFriendly", v)}
            />
            <ToggleRow
              label="Subleases only"
              value={draft.subleaseOnly}
              onValueChange={(v) => set("subleaseOnly", v)}
            />
          </View>

          <View className="bg-gray-50 rounded-2xl p-4 mb-4">
            <SectionHeader icon={Tag} title="Amenities & Utilities" />
            <View className="mb-3">
              <FieldLabel>Amenities</FieldLabel>
              <ChipGroup
                options={FILTER_AMENITY_OPTIONS}
                labels={FILTER_AMENITY_LABELS}
                value={draft.amenities}
                onChange={(v) => set("amenities", v)}
                icons={AMENITY_ICONS}
              />
            </View>
            <View>
              <FieldLabel>Utilities Included</FieldLabel>
              <ChipGroup
                options={UTILITY_OPTIONS}
                labels={UTILITY_LABELS}
                value={draft.utilitiesIncluded}
                onChange={(v) => set("utilitiesIncluded", v)}
                icons={UTILITY_ICONS}
              />
            </View>
          </View>

          <View className="bg-gray-50 rounded-2xl p-4">
            <SectionHeader icon={MapPin} title="Location & Move-in" />
            <View className="mb-3">
              <FieldLabel>Walking distance</FieldLabel>
              <View className="flex-row gap-2.5">
                <NumberField
                  placeholder="Min. to campus"
                  value={draft.distance}
                  onChangeText={(v) => set("distance", v)}
                />
                <NumberField
                  placeholder="Min. to shuttle"
                  value={draft.distanceToShuttle}
                  onChangeText={(v) => set("distanceToShuttle", v)}
                />
              </View>
            </View>
            <View>
              <FieldLabel>Move-in date</FieldLabel>
              <TextInput
                className="h-11 border border-gray-200 rounded-xl px-3 text-sm bg-white"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9ca3af"
                value={draft.moveInDate}
                onChangeText={(v) => set("moveInDate", v)}
              />
            </View>
          </View>
        </ScrollView>

        <View className="flex-row gap-3 p-4 border-t border-gray-100">
          <Button variant="secondary" onPress={() => setDraft(DEFAULT_FILTERS)}>
            Reset
          </Button>
          <View className="flex-1">
            <Button onPress={() => onApply(draft)}>Apply Filters</Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
