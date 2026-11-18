// Move-in Date of the filter sheet: the website's Month and Day dropdowns, as
// one field that opens a bottom sheet with a Month wheel and a Day wheel and a
// Done button (design-system/MASTER.md §11). Month alone means open by the end
// of the next such month; a day makes it by that day of it. The first row of
// each wheel ("Month", "Day") means not set, as the website's placeholders do.
// The Day wheel waits for a month, and February has 29 days. Done sends the
// fields to set, with the website's rules: a day the month does not have is
// dropped, and a new month clears the older moveInDate. Tapping outside the
// sheet closes it without changes.
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown } from "lucide-react-native";
import { FILTER_MONTHS, DAYS_IN_MONTH } from "@proximity/shared";
import { colors } from "../../theme/tokens";

// Wheel row height (h-10). A wheel shows 5 rows (h-[200px]) and the middle one
// is the pick (its band at top-[80px]).
const ROW = 40;

// A scrolling wheel of labels that snaps to a row. index is the row it sits
// on; onChange(i) is called when it comes to rest on another row (or one is
// tapped). Native scrolling, so it flings and snaps as the platform does.
function Wheel({ items, index, onChange, disabled = false, label }) {
  const ref = useRef(null);
  // The row the wheel is on, so a scroll that ends there sends nothing and an
  // index from outside only scrolls when it differs.
  const at = useRef(index);
  useEffect(() => {
    if (at.current === index) return;
    at.current = index;
    ref.current?.scrollTo({ y: index * ROW, animated: true });
  }, [index]);
  const pick = (i) => {
    if (i === at.current) return;
    at.current = i;
    onChange(i);
  };
  // Where a scroll came to rest (a drag let go without a fling, or a fling).
  const settle = (e) => pick(Math.min(items.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ROW))));
  return (
    <View className={`flex-1 h-[200px] ${disabled ? "opacity-40" : ""}`} accessibilityLabel={label}>
      {/* The band behind the picked row. */}
      <View pointerEvents="none" className="absolute inset-x-0 top-[80px] h-10 rounded-lg bg-gray-100" />
      <ScrollView
        ref={ref}
        onLayout={() => ref.current?.scrollTo({ y: index * ROW, animated: false })}
        scrollEnabled={!disabled}
        snapToInterval={ROW}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        // Two empty rows above the first item and below the last, so each one
        // can reach the middle (py-20 = 80pt = 2 rows of ROW).
        contentContainerClassName="py-20"
        onScrollEndDrag={settle}
        onMomentumScrollEnd={settle}
      >
        {items.map((text, i) => (
          <Pressable
            key={text}
            disabled={disabled}
            onPress={() => {
              pick(i);
              ref.current?.scrollTo({ y: i * ROW, animated: true });
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: i === index, disabled }}
            className="h-10 items-center justify-center"
          >
            <Text
              className={`text-lg ${
                i === index ? "font-semibold text-gray-900" : i === 0 ? "text-gray-400" : "text-gray-600"
              }`}
            >
              {text}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const MONTH_ROWS = ["Month", ...FILTER_MONTHS];

export function MoveInPicker({ month, day, onChange }) {
  const insets = useSafeAreaInsets();
  // The wheels' picks while the sheet is open (null when closed). The day is
  // kept as picked, even while a shorter month is passing on the Month wheel;
  // Done drops it if the month it lands on does not have it.
  const [picked, setPicked] = useState(null);
  const days = picked?.month ? DAYS_IN_MONTH[picked.month - 1] : 0;
  const dayRows = ["Day", ...Array.from({ length: days }, (_, i) => String(i + 1))];
  const dayIndex = picked && Number(picked.day) <= days ? Number(picked.day) : 0;

  const done = () => {
    const m = picked.month;
    const patch = { moveInMonth: m, moveInDay: m && Number(picked.day) <= DAYS_IN_MONTH[m - 1] ? picked.day : "" };
    if (m !== (month || "")) patch.moveInDate = "";
    setPicked(null);
    onChange(patch);
  };

  const text = month ? `${FILTER_MONTHS[month - 1]}${day ? ` ${day}` : ""}` : "";
  return (
    <>
      <Pressable
        onPress={() => setPicked({ month: month || "", day: day || "" })}
        accessibilityRole="button"
        accessibilityLabel="Move-in date"
        accessibilityValue={{ text: text || "Any" }}
        className={`h-11 flex-row items-center justify-between rounded-xl border bg-white px-3 ${
          text ? "border-red-600" : "border-gray-300"
        }`}
      >
        <Text className={`text-sm ${text ? "text-gray-900" : "text-gray-400"}`}>{text || "Month / Day"}</Text>
        <ChevronDown size={16} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
      <Modal visible={!!picked} transparent animationType="slide" onRequestClose={() => setPicked(null)}>
        <Pressable className="flex-1 bg-black/30" onPress={() => setPicked(null)} accessibilityLabel="Close" />
        {picked ? (
          <View className="bg-white rounded-t-2xl px-4" style={{ paddingBottom: Math.max(16, insets.bottom) }}>
            <View className="flex-row items-center justify-between h-14">
              <Text className="text-base font-bold text-gray-900">Move-in Date</Text>
              <Pressable onPress={done} hitSlop={12} accessibilityRole="button">
                <Text className="text-base font-semibold text-red-600">Done</Text>
              </Pressable>
            </View>
            <View className="flex-row gap-2">
              <View className="flex-[3]">
                <Wheel
                  label="Month"
                  items={MONTH_ROWS}
                  index={picked.month ? Number(picked.month) : 0}
                  onChange={(i) => setPicked((p) => ({ ...p, month: i ? String(i) : "" }))}
                />
              </View>
              <View className="flex-[2]">
                <Wheel
                  label="Day"
                  items={dayRows}
                  index={dayIndex}
                  disabled={!picked.month}
                  onChange={(i) => setPicked((p) => ({ ...p, day: i ? String(i) : "" }))}
                />
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}
