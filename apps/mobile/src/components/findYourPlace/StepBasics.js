// Find Your Place, page 1: the five answers that decide which places are
// eligible at all. Same questions, options and rules as the website
// (apps/web/src/components/findYourPlace/StepBasics.js).
import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import {
  NO_PREFERENCE,
  GROUP_OPTIONS,
  BIG_GROUP_MIN,
  BIG_GROUP_MAX,
  BUDGET_MIN,
  BUDGET_MAX,
  LEASE_OPTIONS,
  LEASE_OTHER_MIN,
  LEASE_OTHER_MAX,
  MOVE_IN_CHIPS,
  COMMUTE_MODES,
  nextOccurrence,
  moveInMonthOptions,
  moveInLabel,
  slowestMode,
  timeLabel,
} from "@proximity/shared";
import { Chip } from "../ui/Chip";
import { Question, FIELD } from "./ui";
import { colors } from "../../theme/tokens";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function NoPreference({ selected, onPress }) {
  return (
    <Chip tone={selected ? "selected" : "muted"} onPress={onPress}>
      No Preference
    </Chip>
  );
}

// "Other" move-in: the next 18 months in a list, since there is no native select.
function MonthPicker({ visible, value, onPick, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityLabel="Close" />
      <View className="bg-white rounded-t-2xl max-h-[60%]" style={{ paddingBottom: insets.bottom }}>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
          <Text className="text-base font-semibold text-gray-900">Move-in month</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <X size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
        <FlatList
          data={moveInMonthOptions()}
          keyExtractor={(o) => o.value}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onPick(item.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.value === value }}
              className="px-4 py-3.5 border-b border-gray-50 active:bg-gray-50"
            >
              <Text className={`text-sm ${item.value === value ? "font-semibold text-red-600" : "text-gray-800"}`}>
                {item.label}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

export function StepBasics({ answers, onChange, onFollowUpShown }) {
  const set = (patch) => onChange({ ...answers, ...patch });

  // ── People ──────────────────────────────────────────────────────────────
  const groupNum = parseInt(answers.group, 10);
  const bigGroup = Number.isFinite(groupNum) && groupNum >= BIG_GROUP_MIN;
  // The box holds the raw text while it is typed (clamping each keystroke would
  // turn the "1" of "10" into 5); leaving it snaps the number into range.
  const [groupDraft, setGroupDraft] = useState(bigGroup ? String(groupNum) : "");
  useEffect(() => {
    if (bigGroup) setGroupDraft((d) => (parseInt(d, 10) === groupNum ? d : String(groupNum)));
  }, [bigGroup, groupNum]);

  // ── Budget ──────────────────────────────────────────────────────────────
  const budgetOutOfRange =
    typeof answers.budget === "number" && (answers.budget < BUDGET_MIN || answers.budget > BUDGET_MAX);
  // Said once they leave the box, not on the "1" of "1200".
  const [budgetFocused, setBudgetFocused] = useState(false);

  // ── Lease ───────────────────────────────────────────────────────────────
  const leaseIsOther = /^\d+$/.test(answers.lease ?? "");
  // The box shows when the student tapped "Other", and whenever the answer is a
  // month count, however it arrived (a restored run or the profile, both of
  // which land after this page first draws).
  const [leaseOtherOpen, setLeaseOtherOpen] = useState(false);
  const showLeaseOther = leaseOtherOpen || leaseIsOther;
  // Like the group box: the raw text while typing, the answer only while it is
  // in range, and leaving the box snaps it into range.
  const [leaseDraft, setLeaseDraft] = useState(leaseIsOther ? answers.lease : "");
  useEffect(() => {
    if (leaseIsOther) setLeaseDraft((d) => (parseInt(d, 10) === Number(answers.lease) ? d : answers.lease));
  }, [leaseIsOther, answers.lease]);

  // ── Move-in ─────────────────────────────────────────────────────────────
  const chipMonths = MOVE_IN_CHIPS.map((c) => nextOccurrence(c.month));
  const moveInIsOther = !!answers.moveIn && answers.moveIn !== NO_PREFERENCE && !chipMonths.includes(answers.moveIn);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Commute ─────────────────────────────────────────────────────────────
  const mode = slowestMode(answers.modes);
  const toggleMode = (id) => {
    const modes = answers.modes.includes(id) ? answers.modes.filter((m) => m !== id) : [...answers.modes, id];
    // The follow-up is about the slowest mode, so a change of slowest mode asks again.
    const next = slowestMode(modes);
    set({ modes, commuteMax: next && next.id === mode?.id ? answers.commuteMax : null });
  };

  return (
    <View>
      <Question title="How many people are you planning to live with, including yourself?">
        {GROUP_OPTIONS.map((g) =>
          g === "5+" ? (
            <Chip key={g} on={bigGroup} onPress={() => set({ group: bigGroup ? null : String(BIG_GROUP_MIN) })}>
              5+
            </Chip>
          ) : (
            <Chip key={g} on={answers.group === g} onPress={() => set({ group: answers.group === g ? null : g })}>
              {g}
            </Chip>
          )
        )}
        <NoPreference
          selected={answers.group === NO_PREFERENCE}
          onPress={() => set({ group: answers.group === NO_PREFERENCE ? null : NO_PREFERENCE })}
        />
        {bigGroup && (
          <View className="w-full flex-row flex-wrap items-center mt-1">
            <Text className="text-sm text-gray-500 mr-2 mb-2">How many of you?</Text>
            <TextInput
              keyboardType="number-pad"
              accessibilityLabel="How many of you?"
              value={groupDraft}
              onChangeText={(v) => {
                setGroupDraft(v);
                const n = parseInt(v, 10);
                if (Number.isFinite(n) && n >= BIG_GROUP_MIN && n <= BIG_GROUP_MAX) set({ group: String(n) });
              }}
              onBlur={() => {
                const n = parseInt(groupDraft, 10);
                const fixed = clamp(Number.isFinite(n) ? n : groupNum, BIG_GROUP_MIN, BIG_GROUP_MAX);
                setGroupDraft(String(fixed));
                set({ group: String(fixed) });
              }}
              className={`${FIELD(true)} w-20 text-center mr-2 mb-2`}
            />
            <Text className="w-full text-xs text-gray-400">We look for buildings with enough open units to fit everyone.</Text>
          </View>
        )}
      </Question>

      <Question title="What's your max monthly rent per person?">
        {/* "$" and the number share one row and one text style with no line
            height, so they sit on the same line on iOS and Android. */}
        <View
          className={`flex-row items-center h-10 w-32 px-4 mr-2 mb-2 rounded-full border bg-white ${
            typeof answers.budget === "number" ? "border-red-600" : "border-gray-300"
          }`}
        >
          <Text className={`text-[14px] font-medium ${typeof answers.budget === "number" ? "text-red-600" : "text-gray-400"}`}>
            $
          </Text>
          <TextInput
            keyboardType="number-pad"
            placeholder="max / mo"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Max monthly rent per person, in dollars"
            value={typeof answers.budget === "number" ? String(answers.budget) : ""}
            onChangeText={(v) => {
              const n = parseInt(v, 10);
              set({ budget: Number.isFinite(n) && n > 0 ? n : null });
            }}
            onFocus={() => setBudgetFocused(true)}
            onBlur={() => setBudgetFocused(false)}
            textAlignVertical="center"
            className={`flex-1 h-full p-0 ml-0.5 text-[14px] font-medium ${
              typeof answers.budget === "number" ? "text-red-600" : "text-gray-700"
            }`}
          />
        </View>
        <NoPreference
          selected={answers.budget === NO_PREFERENCE}
          onPress={() => set({ budget: answers.budget === NO_PREFERENCE ? null : NO_PREFERENCE })}
        />
        {budgetOutOfRange && !budgetFocused && (
          <Text className="w-full text-xs text-red-600">
            Enter a monthly amount per person between ${BUDGET_MIN.toLocaleString("en-US")} and $
            {BUDGET_MAX.toLocaleString("en-US")}.
          </Text>
        )}
      </Question>

      <Question title="What lease length are you looking for?">
        {LEASE_OPTIONS.map((o) => (
          <Chip
            key={o.id}
            on={answers.lease === o.id}
            onPress={() => {
              setLeaseOtherOpen(false);
              set({ lease: answers.lease === o.id ? null : o.id });
            }}
          >
            {o.label}
          </Chip>
        ))}
        {showLeaseOther ? (
          <View className="flex-row items-center">
            <TextInput
              keyboardType="number-pad"
              autoFocus={leaseOtherOpen}
              placeholder="#"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Lease length in months"
              value={leaseDraft}
              onChangeText={(v) => {
                // Stays open while the box is emptied to type a new number.
                setLeaseOtherOpen(true);
                setLeaseDraft(v);
                const n = parseInt(v, 10);
                if (!Number.isFinite(n)) set({ lease: null });
                else if (n >= LEASE_OTHER_MIN && n <= LEASE_OTHER_MAX) set({ lease: String(n) });
              }}
              onBlur={() => {
                const n = parseInt(leaseDraft, 10);
                if (!Number.isFinite(n)) return;
                const fixed = String(clamp(n, LEASE_OTHER_MIN, LEASE_OTHER_MAX));
                setLeaseDraft(fixed);
                set({ lease: fixed });
              }}
              className={`${FIELD(leaseIsOther)} w-16 text-center mr-2 mb-2`}
            />
            <Text className="text-sm text-gray-500 mr-2 mb-2">months</Text>
          </View>
        ) : (
          <Chip
            onPress={() => {
              setLeaseOtherOpen(true);
              setLeaseDraft("");
              set({ lease: null });
            }}
          >
            Other
          </Chip>
        )}
        <NoPreference
          selected={answers.lease === NO_PREFERENCE}
          onPress={() => {
            setLeaseOtherOpen(false);
            set({ lease: answers.lease === NO_PREFERENCE ? null : NO_PREFERENCE });
          }}
        />
      </Question>

      <Question title="What's your ideal move-in date?">
        {MOVE_IN_CHIPS.map((c, i) => (
          <Chip
            key={c.id}
            on={answers.moveIn === chipMonths[i]}
            onPress={() => set({ moveIn: answers.moveIn === chipMonths[i] ? null : chipMonths[i] })}
          >
            {c.label}
          </Chip>
        ))}
        <Chip on={moveInIsOther} onPress={() => setPickerOpen(true)}>
          {moveInIsOther ? moveInLabel(answers.moveIn) : "Other"}
        </Chip>
        <NoPreference
          selected={answers.moveIn === NO_PREFERENCE}
          onPress={() => set({ moveIn: answers.moveIn === NO_PREFERENCE ? null : NO_PREFERENCE })}
        />
        <MonthPicker
          visible={pickerOpen}
          value={answers.moveIn}
          onClose={() => setPickerOpen(false)}
          onPick={(value) => {
            setPickerOpen(false);
            set({ moveIn: value });
          }}
        />
      </Question>

      <Question title="How do you plan to get to campus? Select all that apply.">
        {COMMUTE_MODES.map((m) => (
          <Chip key={m.id} on={answers.modes.includes(m.id)} onPress={() => toggleMode(m.id)}>
            {m.label}
          </Chip>
        ))}
      </Question>

      {mode && (
        // The follow-up can open below the fold: the screen scrolls to it.
        <Question title={mode.question} onLayout={onFollowUpShown}>
          {mode.times.map((t) => (
            <Chip key={t} on={answers.commuteMax === t} onPress={() => set({ commuteMax: answers.commuteMax === t ? null : t })}>
              {timeLabel(mode, t)}
            </Chip>
          ))}
        </Question>
      )}
    </View>
  );
}
