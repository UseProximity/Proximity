// Shared pieces for Add Listing's wizard steps, mirroring
// apps/web/src/components/listings/wizard/wizardShared.js: one look for
// chips, labels, and the step frame so every screen feels like the same
// product. RN equivalents of web's <button>/<label> primitives.
import { Pressable, Text, View } from "react-native";

export function Chip({ on, children, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3.5 py-2 rounded-full border mr-2 mb-2 ${
        on ? "bg-red-600 border-red-600" : "bg-white border-gray-300"
      }`}
    >
      <Text className={`text-sm font-medium ${on ? "text-white" : "text-gray-700"}`}>{children}</Text>
    </Pressable>
  );
}

export function FieldLabel({ children, optional }) {
  return (
    <Text className="text-sm font-medium text-gray-700 mb-1.5">
      {children}
      {optional ? <Text className="font-normal text-gray-400"> (optional)</Text> : null}
    </Text>
  );
}

// Plus/minus stepper (Airbnb-style) — no typing for counts.
export function Stepper({ value, onChange, min = 0, step = 1, format }) {
  const v = value === "" ? null : Number(value);
  const show = v == null ? "—" : format ? format(v) : String(v);
  const disabledDown = v == null || v <= min;
  const btnCls = "h-8 w-8 items-center justify-center rounded-full border border-gray-300";
  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        onPress={() => onChange(Math.max(min, (v ?? min) - step))}
        disabled={disabledDown}
        className={`${btnCls} ${disabledDown ? "opacity-30" : ""}`}
      >
        <Text className="text-gray-600 text-base">−</Text>
      </Pressable>
      <Text className="min-w-8 text-center text-sm font-semibold text-gray-900">{show}</Text>
      <Pressable onPress={() => onChange(v == null ? Math.max(min, step) : v + step)} className={btnCls}>
        <Text className="text-gray-600 text-base">+</Text>
      </Pressable>
    </View>
  );
}

/*
 * One wizard screen: a big question, optional one-line reassurance, content,
 * and nothing else — matches web's StepFrame so the flow feels like one
 * product across platforms.
 */
export function StepFrame({ title, subtitle, children }) {
  return (
    <View>
      <Text className="text-2xl font-bold tracking-tight text-gray-900">{title}</Text>
      {subtitle ? <Text className="mt-1.5 text-sm text-gray-500">{subtitle}</Text> : null}
      <View className="mt-6">{children}</View>
    </View>
  );
}
