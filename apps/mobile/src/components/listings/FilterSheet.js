// Filter sheet of Browse: the website's phone filter drawer (FiltersPanel in
// apps/web/src/components/listings), with the same filters, options, labels,
// order and controls, all from @proximity/shared. It keeps a draft of the
// filters and sends it only on Apply. Intended differences from the website
// (design-system/MASTER.md §11): a full-screen modal, the app's own icons on
// amenity and utility chips and a check mark on the other chips, the app's red,
// a calendar instead of Month and Day dropdowns, and Clear All also closes it.
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  X,
  PawPrint,
  Dumbbell,
  BookOpen,
  WavesHorizontal,
  WashingMachine,
  Thermometer,
  Mail,
  Package,
  Car,
  Zap,
  Flame,
  Droplets,
  Wifi,
  Trash2,
  Tv,
  Utensils,
  Toilet,
} from "lucide-react-native";
import {
  DEFAULT_FILTERS,
  BED_STEPS,
  BATH_STEPS,
  CAMPUS_STEPS,
  SHUTTLE_STEPS,
  FILTER_DURATIONS,
  FILTER_HOME_TYPES,
  FILTER_AMENITIES,
  FILTER_UTILITIES,
  FILTER_FURNISHED,
  durationLabel,
  durationMonths,
  durationFromMonths,
  stepIndex,
  stepLimits,
  rentRange,
  rentFilters,
} from "@proximity/shared";
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { StepRange } from "../ui/RangeSlider";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { MoveInPicker } from "./MoveInPicker";
import { colors } from "../../theme/tokens";

// An icon on every amenity and utility chip, to aid recognition.
const AMENITY_ICONS = {
  dishwasher: Utensils,
  pets_allowed: PawPrint,
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
  sewer: Toilet,
};

// A titled block. With onClear (passed while the filter has something filled
// in) a small Clear sits next to the title, as on the website.
function Section({ title, onClear, children }) {
  return (
    <View className="mt-6">
      <View className="flex-row items-baseline gap-2 mb-2">
        <Text className="text-[15px] font-bold text-gray-900">{title}</Text>
        {onClear ? (
          <Pressable onPress={onClear} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Clear ${title}`}>
            <Text className="text-xs font-medium text-red-600">Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// Lease durations added with "Other" (and any in the filters that are not one
// of the three offered), kept as chips while the sheet is open.
const extraDurations = (filters) => (filters.leaseAvailability || []).filter((v) => !FILTER_DURATIONS.includes(v));

// rentsFor(filters) gives the rents the price histogram draws. onReset clears
// the filters, the search and the Find Your Place hints (and closes the sheet).
export function FilterSheet({ visible, filters, suggested = null, rentsFor, onApply, onReset, onClose }) {
  const [draft, setDraft] = useState(filters);
  const [addedDurations, setAddedDurations] = useState(() => extraDurations(filters));
  // The "Other" box of Duration: null when closed, else the text typed so far.
  const [otherMonths, setOtherMonths] = useState(null);
  // A slider is being dragged: the list holds still meanwhile.
  const [dragging, setDragging] = useState(false);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  useEffect(() => {
    if (!visible) return;
    setDraft(filters);
    setAddedDurations(extraDurations(filters));
    setOtherMonths(null);
  }, [visible, filters]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const toggle = (field, value) =>
    setDraft((d) => {
      const cur = d[field] || [];
      return { ...d, [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });

  // Clear for a section: there only while one of its fields is filled in, and
  // empties those fields ("" for a value, [] for a list).
  const clearer = (...fields) =>
    fields.some((f) => (Array.isArray(draft[f]) ? draft[f].length : draft[f]))
      ? () => set(Object.fromEntries(fields.map((f) => [f, Array.isArray(DEFAULT_FILTERS[f]) ? [] : ""])))
      : undefined;

  // The histogram follows the draft's other filters. The price range does not
  // change it, so a drag of the price slider does not work it out again.
  const histogramKey = visible ? JSON.stringify({ ...draft, minRent: "", maxRent: "" }) : null;
  const rents = useMemo(() => (histogramKey ? rentsFor(JSON.parse(histogramKey)) : []), [rentsFor, histogramKey]);
  const price = rentRange(draft.minRent, draft.maxRent);

  const addDuration = () => {
    const value = durationFromMonths(otherMonths);
    setOtherMonths(null);
    if (!value) return;
    if (!FILTER_DURATIONS.includes(value)) setAddedDurations((added) => (added.includes(value) ? added : [...added, value]));
    setDraft((d) => (d.leaseAvailability.includes(value) ? d : { ...d, leaseAvailability: [...d.leaseAvailability, value] }));
  };
  // Apply also takes a valid number still sitting in the "Other" box, not yet
  // confirmed with Return or Add, so the lease length just typed is not lost.
  const apply = () => {
    const typed = durationFromMonths(otherMonths);
    onApply(
      typed && !draft.leaseAvailability.includes(typed)
        ? { ...draft, leaseAvailability: [...draft.leaseAvailability, typed] }
        : draft
    );
  };
  const durationOptions = [...FILTER_DURATIONS, ...addedDurations]
    .sort((a, b) => durationMonths(a) - durationMonths(b))
    .map((value) => ({ label: durationLabel(value), value }));

  const stepSlider = (title, steps, lowKey, highKey) => (
    <Section title={title} onClear={clearer(lowKey, highKey)}>
      <View className="px-3">
        <StepRange
          steps={steps}
          label={title}
          low={stepIndex(steps, draft[lowKey], 0)}
          high={stepIndex(steps, draft[highKey], steps.length - 1)}
          onDragging={setDragging}
          onChange={(low, high) => {
            const [min, max] = stepLimits(steps, { low, high });
            set({ [lowKey]: min, [highKey]: max });
          }}
        />
      </View>
    </Section>
  );
  const distanceSlider = (title, steps, field) => (
    <Section title={title} onClear={clearer(field)}>
      <View className="px-3">
        <StepRange
          steps={steps}
          label={title}
          single
          high={stepIndex(steps, draft[field], steps.length - 1)}
          onDragging={setDragging}
          onChange={(_, high) => set({ [field]: steps[high].value })}
        />
      </View>
    </Section>
  );
  // Chips: several can be on (field holds an array), or with single exactly
  // one. `hints` are Find Your Place's suggestions, marked while switched off.
  const chips = (title, field, options, { single = false, icons = null, hints = [], after = null } = {}) => (
    <Section title={title} onClear={clearer(field)}>
      <View className="flex-row flex-wrap">
        {options.map(({ label, value }) => {
          const on = single ? (draft[field] || "") === value : (draft[field] || []).includes(value);
          return (
            <Chip
              key={value}
              on={on}
              tone={!on && hints.includes(value) ? "suggested" : undefined}
              onPress={() => (single ? set({ [field]: value }) : toggle(field, value))}
              icon={icons?.[value]}
              showCheck={!icons}
            >
              {label}
            </Chip>
          );
        })}
        {after}
      </View>
    </Section>
  );

  // "Other" chip of Duration: opens a small box for a number of months, which
  // Return or Add turns into a selected chip in the list. Tapping anywhere
  // else closes it without adding.
  const otherDuration =
    otherMonths === null ? (
      <Pressable
        onPress={() => setOtherMonths("")}
        accessibilityRole="button"
        className="px-3.5 py-2 rounded-full border border-dashed border-gray-300 bg-white mr-2 mb-2"
      >
        <Text className="text-sm font-medium text-gray-700">Other</Text>
      </Pressable>
    ) : (
      <View className="flex-row items-center pl-3.5 pr-1 py-1 rounded-full border border-red-600 bg-white mr-2 mb-2">
        <TextInput
          autoFocus
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel="Lease length in months"
          placeholder="9"
          placeholderTextColor={colors.textMuted}
          maxLength={2}
          value={otherMonths}
          onChangeText={(t) => setOtherMonths(t.replace(/\D/g, ""))}
          onSubmitEditing={addDuration}
          onBlur={() => setOtherMonths(null)}
          className="w-7 text-sm text-center text-gray-900"
        />
        <Text className="text-sm font-medium text-gray-700">months</Text>
        <Pressable onPress={addDuration} accessibilityRole="button" className="ml-2 h-8 px-3 rounded-full bg-red-600 justify-center">
          <Text className="text-sm font-medium text-white">Add</Text>
        </Pressable>
      </View>
    );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* The footer rides above the keyboard (iOS); Android resizes the window. */}
      <KeyboardAvoidingView className="flex-1 bg-white pt-14" behavior={Platform.OS === "ios" ? "padding" : undefined}>
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

        <ScrollView
          contentContainerClassName="px-[16px] pb-[24px]"
          scrollEnabled={!dragging}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Section title="Price Range" onClear={clearer("minRent", "maxRent")}>
            <View className="px-3">
              <PriceRangeSlider
                rents={rents}
                low={price.low}
                high={price.high}
                onDragging={setDragging}
                onChange={(low, high) => set(rentFilters({ low, high }))}
              />
            </View>
          </Section>
          {stepSlider("Bedrooms", BED_STEPS, "bedrooms", "maxBedrooms")}
          {stepSlider("Bathrooms", BATH_STEPS, "bathrooms", "maxBathrooms")}
          {distanceSlider("Walking Distance to Campus", CAMPUS_STEPS, "distance")}
          {distanceSlider("Walking Distance to Shuttle", SHUTTLE_STEPS, "distanceToShuttle")}
          {chips("Duration", "leaseAvailability", durationOptions, { after: otherDuration })}
          <Section title="Move-in Date" onClear={clearer("moveInMonth", "moveInDay", "moveInDate")}>
            <MoveInPicker month={draft.moveInMonth} day={draft.moveInDay} onChange={set} />
          </Section>
          {chips("Home Type", "homeType", FILTER_HOME_TYPES)}
          {chips("Amenities", "amenities", FILTER_AMENITIES, { icons: AMENITY_ICONS, hints: suggested?.amenities ?? [] })}
          {chips("Utilities Included", "utilitiesIncluded", FILTER_UTILITIES, { icons: UTILITY_ICONS })}
          {chips("Furnished", "furnished", FILTER_FURNISHED, {
            single: true,
            hints: suggested?.furnished ? [suggested.furnished] : [],
          })}

          <View className="mt-7">
            <Text className="text-xs text-red-600">Not seeing what you want?</Text>
            <Text className="text-xs text-red-600">{"Tell us about what you're looking for, and we'll find it for you!"}</Text>
          </View>
          <Pressable
            onPress={() => {
              onClose();
              router.navigate("/find-your-place");
            }}
            accessibilityRole="button"
            hitSlop={6}
            className="mt-2.5 self-start h-9 px-4 rounded-full border border-red-600 bg-red-50 justify-center"
          >
            <Text className="text-sm font-bold text-red-600">Find Your Place</Text>
          </Pressable>
        </ScrollView>

        {/* Keep the buttons clear of the home indicator. */}
        <View className="flex-row gap-3 p-4 border-t border-gray-100" style={{ paddingBottom: Math.max(16, insets.bottom) }}>
          <Button variant="secondary" onPress={onReset}>
            Clear All
          </Button>
          <View className="flex-1">
            <Button onPress={apply}>Apply Your Filter Preference</Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
