// Screen 3: the units — the lease facts landlords care about most, asked
// early (rent, beds/baths, terms). One card per floor-plan type; steppers
// for counts, chips for lease terms, typing only for the rent number.
// Mirrors apps/web/src/components/listings/wizard/StepUnits.js.
import { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { LEASE_TERM_PRESETS } from "@proximity/shared";
import { Card } from "../../ui/Card";
import { TextField } from "../../ui/TextField";
import { Chip, Stepper, StepFrame } from "./wizardShared";

export default function StepUnits({ w }) {
  const [customTerm, setCustomTerm] = useState({});

  const addCustom = (i) => {
    const n = Number(customTerm[i]);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!(w.units[i].leaseTermMonths || []).includes(n)) w.toggleUnitTerm(i, n);
    setCustomTerm((p) => ({ ...p, [i]: "" }));
  };

  return (
    <StepFrame
      title="Units and rent"
      subtitle="One card per floor plan. A 12-unit building is usually just 2 or 3 of these."
    >
      <View className="gap-3">
        {w.units.map((unit, i) => (
          <Card key={i}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-xs font-semibold uppercase tracking-wide text-gray-400">Unit {i + 1}</Text>
              {w.units.length > 1 ? (
                <Pressable onPress={() => w.removeUnit(i)} hitSlop={8}>
                  <Text className="text-gray-300 text-lg leading-none">×</Text>
                </Pressable>
              ) : null}
            </View>

            <View className="flex-row gap-6">
              <View>
                <Text className="mb-1.5 text-xs font-medium text-gray-600">Bedrooms</Text>
                <Stepper value={unit.bedrooms} min={0} onChange={(v) => w.updateUnit(i, "bedrooms", v)} />
              </View>
              <View>
                <Text className="mb-1.5 text-xs font-medium text-gray-600">Bathrooms</Text>
                <Stepper value={unit.bathrooms} min={0} step={0.5} onChange={(v) => w.updateUnit(i, "bathrooms", v)} />
              </View>
            </View>

            <View className="flex-row gap-3 mt-4">
              <TextField
                className="flex-1"
                label="Rent, whole unit ($/mo)"
                keyboardType="numeric"
                value={unit.rent}
                onChangeText={(v) => w.updateUnit(i, "rent", v)}
                placeholder="e.g. 1400"
              />
              <TextField
                className="flex-1"
                label="Sq ft (optional)"
                keyboardType="numeric"
                value={unit.area}
                onChangeText={(v) => w.updateUnit(i, "area", v)}
              />
            </View>

            <View className="mt-4">
              <Text className="mb-1.5 text-xs font-medium text-gray-600">Lease terms offered</Text>
              <View className="flex-row flex-wrap items-center">
                {LEASE_TERM_PRESETS.map((p) => (
                  <Chip
                    key={p.label}
                    on={(unit.leaseTermMonths || []).includes(p.months)}
                    onPress={() => w.toggleUnitTerm(i, p.months)}
                  >
                    {p.label}
                  </Chip>
                ))}
                {(unit.leaseTermMonths || [])
                  .filter((m) => !LEASE_TERM_PRESETS.some((p) => p.months === m))
                  .map((m) => (
                    <Chip key={m} on onPress={() => w.toggleUnitTerm(i, m)}>
                      {m}-Month ×
                    </Chip>
                  ))}
              </View>
              <View className="flex-row items-center gap-2 mt-1">
                <TextInput
                  value={customTerm[i] ?? ""}
                  onChangeText={(v) => setCustomTerm((p) => ({ ...p, [i]: v }))}
                  onSubmitEditing={() => addCustom(i)}
                  keyboardType="number-pad"
                  placeholder="# months"
                  placeholderTextColor="#9ca3af"
                  className="w-24 h-9 rounded-full border border-gray-300 px-3 text-sm"
                />
                {(customTerm[i] ?? "") !== "" ? (
                  <Pressable onPress={() => addCustom(i)} className="rounded-full bg-red-600 px-3 py-2">
                    <Text className="text-xs font-medium text-white">Add</Text>
                  </Pressable>
                ) : (
                  <Text className="text-[11px] text-gray-400">type a number, then Add</Text>
                )}
              </View>
            </View>

            <TextField
              className="mt-4"
              label="Floor plan name (optional)"
              value={unit.title ?? ""}
              onChangeText={(v) => w.updateUnit(i, "title", v)}
              placeholder='e.g. "The Loft"'
            />

            <View className="flex-row items-center justify-between mt-4">
              <Text className="text-sm text-gray-700">Currently available</Text>
              <Switch value={unit.available !== false} onValueChange={(v) => w.updateUnit(i, "available", v)} />
            </View>
          </Card>
        ))}
      </View>

      <Pressable onPress={w.addUnit} className="mt-4">
        <Text className="text-sm font-medium text-red-600">+ Add another floor plan</Text>
      </Pressable>
    </StepFrame>
  );
}
