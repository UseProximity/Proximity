// Pinned row of section chips on the listing detail page. It owns all of its
// horizontal scrolling: whenever the active chip changes, the row centres it,
// clamped to the scroll limits so the first and last chips simply rest at the
// edges (no extra padding). The page's vertical scrolling never touches this
// row; the two only meet through `activeKey` and `onSelect`.
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { shadows } from "../../theme/tokens";

// Closer than this to centre is close enough: the row stays put.
const CENTER_TOLERANCE = 24;

export function SectionNav({ sections, activeKey, onSelect, height }) {
  const scrollRef = useRef(null);
  const rowWidth = useRef(0);
  const contentWidth = useRef(0);
  const chips = useRef({}); // key -> { x, width }, relative to the content
  const offsetX = useRef(0); // the row's current horizontal offset
  const lastTarget = useRef(null); // the last offset asked for, so it is not asked twice
  const dragging = useRef(false); // the user's finger is on the row
  const placed = useRef(false); // the first centring has happened
  // Read by the layout callbacks, which can fire after the active chip changed.
  const active = useRef(activeKey);
  active.current = activeKey;
  const keys = useRef([]);
  keys.current = sections.map((s) => s.key);

  function centre(animated) {
    const key = active.current;
    const chip = chips.current[key];
    // Wait until the row, its content and every chip have been measured.
    if (!key || !chip || !rowWidth.current || !contentWidth.current) return;
    if (!keys.current.every((k) => chips.current[k])) return;
    if (dragging.current) return;

    const max = Math.max(0, contentWidth.current - rowWidth.current);
    const target = Math.min(max, Math.max(0, chip.x + chip.width / 2 - rowWidth.current / 2));
    const first = !placed.current;
    placed.current = true;
    if (!first && Math.abs(target - offsetX.current) < CENTER_TOLERANCE) return;
    if (target === lastTarget.current) return;
    lastTarget.current = target;
    scrollRef.current?.scrollTo({ x: target, animated: animated && !first });
  }

  // A new active chip: slide to it.
  useEffect(() => {
    centre(true);
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onLayout={(e) => {
        rowWidth.current = e.nativeEvent.layout.width;
        centre(false);
      }}
      onContentSizeChange={(w) => {
        contentWidth.current = w;
        centre(false);
      }}
      onScroll={(e) => {
        offsetX.current = e.nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={32}
      onScrollBeginDrag={() => {
        dragging.current = true;
        lastTarget.current = null;
      }}
      onScrollEndDrag={() => {
        dragging.current = false;
      }}
      onMomentumScrollEnd={() => {
        dragging.current = false;
      }}
      className="bg-white border-b border-gray-200"
      style={[{ height, flexGrow: 0 }, shadows.subtle]}
      contentContainerStyle={{ paddingHorizontal: 12, alignItems: "center", gap: 8 }}
    >
      {sections.map((section) => {
        const isActive = activeKey === section.key;
        return (
          <Pressable
            key={section.key}
            onLayout={(e) => {
              chips.current[section.key] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
              centre(false);
            }}
            onPress={() => onSelect(section.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`Go to ${section.label}`}
            hitSlop={{ top: 6, bottom: 6 }}
            className={`px-4 py-2 rounded-full border ${
              isActive
                ? "bg-red-600 border-red-600 active:bg-red-700"
                : "bg-gray-100 border-gray-300 active:bg-gray-300"
            }`}
          >
            <Text className={`text-sm font-semibold ${isActive ? "text-white" : "text-gray-800"}`}>{section.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
