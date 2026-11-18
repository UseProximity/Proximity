// Move-in Date of the filter sheet: a field showing the chosen date that opens
// a calendar (design-system/MASTER.md §11). The filter stores what the
// website's Month and Day dropdowns store, a month and a day with no year,
// meaning "open by that day, its next occurrence" (moveInDeadline). So only
// today to a year ahead can be picked, the dates a month and a day name
// unambiguously; earlier and later days are greyed out. A month without a day
// (Find Your Place can hand one over) means the end of that month, and shows
// as that date. Picking a day stores it and closes the calendar, clearing the
// older moveInDate as the website's month dropdown does; tapping outside
// closes it without changes.
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react-native";
import { FILTER_MONTHS, moveInDeadline } from "@proximity/shared";
import { colors } from "../../theme/tokens";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A comparable number for a date (month 0 to 11).
const dayKey = (y, m, d) => y * 10000 + (m + 1) * 100 + d;
const dateText = (y, m, d) => `${FILTER_MONTHS[m]} ${d}, ${y}`;

export function MoveInPicker({ month, day, onChange }) {
  // The month the calendar shows ({ y, m }), or null while it is closed.
  const [view, setView] = useState(null);

  const now = new Date();
  const first = { y: now.getFullYear(), m: now.getMonth() };
  const todayKey = dayKey(first.y, first.m, now.getDate());
  // The last day that can be picked: a year from today, minus a day.
  const end = new Date(first.y + 1, first.m, now.getDate() - 1);
  const last = { y: end.getFullYear(), m: end.getMonth() };
  const lastKey = dayKey(last.y, last.m, end.getDate());

  // The date the filter means, from its month and day.
  const deadline = month ? moveInDeadline(month, day) : null;
  const chosen = deadline && { y: Number(deadline.slice(0, 4)), m: Number(deadline.slice(5, 7)) - 1, d: Number(deadline.slice(8, 10)) };
  const chosenKey = chosen ? dayKey(chosen.y, chosen.m, chosen.d) : null;

  const close = () => setView(null);
  const pick = (m, d) => {
    close();
    onChange({ moveInMonth: String(m + 1), moveInDay: String(d), moveInDate: "" });
  };

  const atFirst = view && view.y === first.y && view.m === first.m;
  const atLast = view && view.y === last.y && view.m === last.m;
  const shift = (by) => setView(({ y, m }) => ({ y: y + Math.floor((m + by) / 12), m: (m + by + 12) % 12 }));
  const arrow = (Icon, disabled, by, label) => (
    <Pressable
      onPress={() => shift(by)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className="w-[44px] h-[44px] items-center justify-center"
    >
      <Icon size={20} color={disabled ? colors.border : colors.primary} strokeWidth={2.5} />
    </Pressable>
  );

  // The shown month's cells: blanks before the 1st, then its days.
  const cells = [];
  if (view) {
    const blanks = new Date(view.y, view.m, 1).getDay();
    const days = new Date(view.y, view.m + 1, 0).getDate();
    for (let i = 0; i < blanks; i++) cells.push(<View key={`blank${i}`} className="w-[14.28%] h-[40px]" />);
    for (let d = 1; d <= days; d++) {
      const key = dayKey(view.y, view.m, d);
      const disabled = key < todayKey || key > lastKey;
      const selected = key === chosenKey;
      const today = key === todayKey;
      cells.push(
        <Pressable
          key={d}
          onPress={() => pick(view.m, d)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={dateText(view.y, view.m, d)}
          accessibilityState={{ disabled, selected }}
          className="w-[14.28%] h-[40px] items-center justify-center"
        >
          <View
            className={`w-[36px] h-[36px] rounded-full items-center justify-center ${
              selected ? "bg-red-600" : today ? "border-2 border-red-600" : ""
            }`}
          >
            <Text
              className={`text-base ${
                selected ? "font-semibold text-white" : disabled ? "text-gray-300" : today ? "font-semibold text-red-600" : "text-gray-900"
              }`}
            >
              {d}
            </Text>
          </View>
        </Pressable>
      );
    }
  }

  const text = chosen ? dateText(chosen.y, chosen.m, chosen.d) : "";
  return (
    <>
      <Pressable
        onPress={() => setView(chosen ? { y: chosen.y, m: chosen.m } : first)}
        accessibilityRole="button"
        accessibilityLabel="Move-in date"
        accessibilityValue={{ text: text || "Not set" }}
        className={`h-11 flex-row items-center justify-between rounded-xl border bg-white px-3 ${
          text ? "border-red-600" : "border-gray-300"
        }`}
      >
        <Text className={`text-sm ${text ? "text-gray-900" : "text-gray-400"}`}>{text || "Select a date"}</Text>
        <ChevronDown size={16} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
      <Modal visible={!!view} transparent animationType="fade" onRequestClose={close}>
        {/* The screen, with the card centred 16pt in from the sides over a
            dimmed backdrop that closes it. The card's height is its content;
            each day cell is a seventh of its width (14.28%, as 14.29% would
            add up to more than a row and wrap the seventh day) and 40pt tall. */}
        <View className="flex-1 justify-center px-[16px]">
          <Pressable className="absolute top-0 right-0 bottom-0 left-0 bg-black/40" onPress={close} accessibilityLabel="Close calendar" />
          {view ? (
            <View className="bg-white rounded-[16px] p-[16px]">
              <View className="flex-row items-center justify-between h-[44px]">
                <Text className="text-base font-bold text-gray-900">{`${FILTER_MONTHS[view.m]} ${view.y}`}</Text>
                <View className="flex-row">
                  {arrow(ChevronLeft, atFirst, -1, "Previous month")}
                  {arrow(ChevronRight, atLast, 1, "Next month")}
                </View>
              </View>
              <View className="flex-row">
                {WEEKDAYS.map((name) => (
                  <View key={name} className="w-[14.28%] h-[28px] items-center justify-center">
                    <Text className="text-xs font-semibold text-gray-400">{name}</Text>
                  </View>
                ))}
              </View>
              <View className="flex-row flex-wrap">{cells}</View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
