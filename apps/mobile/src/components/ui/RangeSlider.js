// Range slider of the Browse filters, the app's version of the website's
// (apps/web/src/components/listings/FilterComponents.js): a red track between
// round red handles, with labels under them. low and high are numbers between
// min and max; onChange(low, high) is called only when one actually changes.
// With `single`, only the high handle shows and the track runs from the left
// end to it (pass low as min). With `ticks` (one label per step, from min),
// every step is labelled, the selected ones in red, and tapping one picks it;
// otherwise formatLabel(value) labels each handle. minGap is how close the
// handles may get (default one step; 0 lets them meet). onDragging(true/false)
// says when a drag starts and ends, so a scroll view around it can hold still.
//
// Built on React Native's own PanResponder (no gesture library): the handle is
// chosen once, on press, and then follows the finger, kept minGap clear of the
// other one, as on the website. Positions are runtime values from the slider's
// values and width, so they are inline styles.
import { useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";

// Visible handle size, and the height of the row the finger can press (44pt,
// design-system/MASTER.md §9).
const HANDLE = 22;
const ROW = 44;
// Labels whose handles are closer than this (% of the track) merge into one.
const LABEL_MERGE_PCT = 16;
const LABEL_WIDTH = 64;

export function RangeSlider({
  min,
  max,
  step = 1,
  minGap = step,
  single = false,
  low,
  high,
  onChange,
  formatLabel,
  ticks,
  label,
  onDragging,
}) {
  const [width, setWidth] = useState(0);
  // Left edge of the row in the window, for turning a touch into a position.
  const left = useRef(0);
  const rowRef = useRef(null);
  // What the responder below reads: it is created once, so it reads the
  // latest props from here.
  const latest = useRef(null);
  latest.current = { min, max, step, minGap, single, low, high, onChange, width, onDragging };
  // Drag in progress: { handle, offset, startX }. handle is null until known.
  const drag = useRef(null);

  const pctOf = (v) => ((v - min) / (max - min)) * 100;
  // Centre of a handle, in px from the row's left edge.
  const xOf = (pct) => HANDLE / 2 + (pct / 100) * (width - HANDLE);

  const responder = useRef(null);
  // Moves a handle by value (also used by the accessibility actions).
  const moveRef = useRef(null);
  if (!responder.current) {
    const centre = (v) => {
      const p = latest.current;
      return HANDLE / 2 + ((v - p.min) / (p.max - p.min)) * (p.width - HANDLE);
    };
    const valueAt = (x) => {
      const p = latest.current;
      const raw = p.min + ((x - HANDLE / 2) / (p.width - HANDLE)) * (p.max - p.min);
      return p.min + Math.round((raw - p.min) / p.step) * p.step;
    };
    const move = (handle, value) => {
      const p = latest.current;
      const v = Math.min(p.max, Math.max(p.min, value));
      const next = handle === "low" ? [Math.min(v, p.high - p.minGap), p.high] : [p.low, Math.max(v, p.low + p.minGap)];
      if (next[0] !== p.low || next[1] !== p.high) p.onChange(next[0], next[1]);
    };
    // Pressing on a handle keeps the finger's offset from its centre; pressing
    // on the track jumps the handle there.
    const grab = (handle, x) => {
      const p = latest.current;
      const d = x - centre(handle === "low" ? p.low : p.high);
      const onHandle = Math.abs(d) <= HANDLE / 2;
      drag.current = { handle, offset: onHandle ? d : 0 };
      if (!onHandle) move(handle, valueAt(x));
    };
    const end = () => {
      drag.current = null;
      latest.current.onDragging?.(false);
    };
    responder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A scroll view must not take over a drag that has started.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const p = latest.current;
        if (!p.width) return;
        p.onDragging?.(true);
        const x = e.nativeEvent.pageX - left.current;
        const lowX = centre(p.low);
        const highX = centre(p.high);
        if (p.single) grab("high", x);
        else if (Math.abs(x - lowX) <= HANDLE / 2 && Math.abs(x - highX) <= HANDLE / 2) {
          // Both handles are under the finger: the first move decides which one.
          drag.current = { handle: null, startX: x };
        } else grab(Math.abs(x - lowX) <= Math.abs(x - highX) ? "low" : "high", x);
      },
      onPanResponderMove: (e) => {
        if (!drag.current) return;
        const x = e.nativeEvent.pageX - left.current;
        if (!drag.current.handle) {
          const { startX } = drag.current;
          if (Math.abs(x - startX) < 2) return;
          grab(x < startX ? "low" : "high", startX);
        }
        move(drag.current.handle, valueAt(x - drag.current.offset));
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
    moveRef.current = move;
  }

  const lowPct = pctOf(low);
  const highPct = pctOf(high);
  const valueText = (v) => (ticks ? ticks[Math.round((v - min) / step)] : formatLabel(v));

  // A handle is also an adjustable control for VoiceOver and TalkBack.
  const handle = (which, value, pct) => (
    <View
      key={which}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${label ? `${label} ` : ""}${which === "low" ? "minimum" : "maximum"}`}
      accessibilityValue={{ text: valueText(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) =>
        moveRef.current(which, value + (e.nativeEvent.actionName === "increment" ? step : -step))
      }
      className="absolute rounded-full bg-red-600 border-2 border-white"
      style={{ width: HANDLE, height: HANDLE, left: xOf(pct) - HANDLE / 2, top: (ROW - HANDLE) / 2 }}
    />
  );
  const valueLabel = (pct, text, wide = 1) => (
    <Text
      key={text}
      className="absolute text-xs font-medium text-red-600 text-center"
      style={{ width: LABEL_WIDTH * wide, left: xOf(pct) - (LABEL_WIDTH * wide) / 2 }}
    >
      {text}
    </Text>
  );

  return (
    <View>
      <View
        ref={rowRef}
        style={{ height: ROW }}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
          rowRef.current?.measureInWindow((x) => {
            left.current = x;
          });
        }}
        {...responder.current.panHandlers}
      >
        {width > 0 ? (
          <>
            <View
              className="absolute h-0.5 bg-gray-200"
              style={{ left: HANDLE / 2, right: HANDLE / 2, top: ROW / 2 - 1 }}
            />
            <View
              className="absolute h-0.5 bg-red-600"
              style={{ left: xOf(lowPct), width: xOf(highPct) - xOf(lowPct), top: ROW / 2 - 1 }}
            />
            {single ? null : handle("low", low, lowPct)}
            {handle("high", high, highPct)}
          </>
        ) : null}
      </View>
      {width > 0 ? (
        <View className="h-6">
          {ticks
            ? // Each step's label picks exactly that step (both handles go to
              // it; with single, the one handle does).
              ticks.map((text, i) => {
                const v = min + i * step;
                const selected = v === high || (!single && v === low);
                return (
                  <Pressable
                    key={text}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    hitSlop={8}
                    onPress={() => {
                      if ((single ? low : v) !== low || v !== high) onChange(single ? low : v, v);
                    }}
                    className="absolute h-6 justify-center"
                    style={{ width: LABEL_WIDTH, left: xOf(pctOf(v)) - LABEL_WIDTH / 2 }}
                  >
                    <Text className={`text-xs font-medium text-center ${selected ? "text-red-600" : "text-gray-400"}`}>
                      {text}
                    </Text>
                  </Pressable>
                );
              })
            : highPct - lowPct < LABEL_MERGE_PCT
              ? valueLabel((lowPct + highPct) / 2, `${formatLabel(low)} – ${formatLabel(high)}`, 2)
              : [valueLabel(lowPct, formatLabel(low)), valueLabel(highPct, formatLabel(high))]}
        </View>
      ) : null}
    </View>
  );
}

// RangeSlider over named steps ({ label, value }), labelling every step. low
// and high are step indexes and may be equal; with single only high is used.
export function StepRange({ steps, low = 0, high, single, label, onChange, onDragging }) {
  return (
    <RangeSlider
      min={0}
      max={steps.length - 1}
      minGap={0}
      single={single}
      low={low}
      high={high}
      label={label}
      onChange={onChange}
      onDragging={onDragging}
      ticks={steps.map((s) => s.label)}
    />
  );
}
