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
// Built on React Native's own PanResponder and Animated (no gesture library).
// The handle is chosen once, on press, and then follows the finger, kept
// minGap clear of the other one. The value is the closest allowed one, which
// onChange gets as it changes. By default the handle steps from value to value.
// With `continuous` it moves freely with the finger (its position is an
// Animated value set straight from the touch, so this needs no React render)
// and settles on the value on release, gliding there too when the value
// changes from outside. Positions are runtime values, so they are inline
// styles.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, Text, View } from "react-native";

// Visible handle size, and the height of the row the finger can press (44pt,
// design-system/MASTER.md §9).
const HANDLE = 22;
const ROW = 44;
// Labels whose handles are closer than this (% of the track) merge into one.
const LABEL_MERGE_PCT = 16;
const LABEL_WIDTH = 64;
// How long a handle takes to settle on its value (release, tap, accessibility).
const SETTLE_MS = 120;

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
  continuous = false,
}) {
  const [width, setWidth] = useState(0);
  // Left edge of the row in the window, for turning a touch into a position.
  const left = useRef(0);
  const rowRef = useRef(null);
  // Centre of each handle, in px from the row's left edge.
  const pos = useRef({ low: new Animated.Value(0), high: new Animated.Value(0) }).current;
  // Derived positions: the red fill's width, and the middle of the handles.
  const derived = useRef({
    fill: Animated.subtract(pos.high, pos.low),
    middle: Animated.multiply(Animated.add(pos.low, pos.high), 0.5),
  }).current;
  // What the responder below reads: it is created once, so it reads the
  // latest props from here.
  const latest = useRef(null);
  latest.current = { min, max, step, minGap, single, low, high, onChange, width, onDragging, continuous };
  // Drag in progress: { handle, offset, value } or { handle: null, startX }
  // while it is not yet known which of two stacked handles moves.
  const drag = useRef(null);

  const pctOf = (v) => ((v - min) / (max - min)) * 100;
  const xOf = (pct) => HANDLE / 2 + (pct / 100) * (width - HANDLE);

  // A handle not being dragged sits on its value: placed at once, or with
  // `continuous` gliding there after the first layout (a tick tap, an
  // accessibility action, a reset).
  // Where each handle was last sent, so one that keeps its place is left alone.
  const placed = useRef({ low: null, high: null });
  const laidOut = useRef(false);
  useEffect(() => {
    if (!width) return;
    for (const [which, value] of [["low", low], ["high", high]]) {
      if (drag.current?.handle === which) continue;
      const x = HANDLE / 2 + ((value - min) / (max - min)) * (width - HANDLE);
      if (placed.current[which] === x) continue;
      placed.current[which] = x;
      if (laidOut.current && continuous) {
        Animated.timing(pos[which], { toValue: x, duration: SETTLE_MS, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
      } else pos[which].setValue(x);
    }
    laidOut.current = true;
  }, [low, high, width, min, max, continuous, pos]);

  const responder = useRef(null);
  // Moves a handle to a value (the accessibility actions).
  const moveRef = useRef(null);
  if (!responder.current) {
    const centre = (v) => {
      const p = latest.current;
      return HANDLE / 2 + ((v - p.min) / (p.max - p.min)) * (p.width - HANDLE);
    };
    // The closest allowed value to a position.
    const valueAt = (x) => {
      const p = latest.current;
      const raw = p.min + ((x - HANDLE / 2) / (p.width - HANDLE)) * (p.max - p.min);
      return Math.min(p.max, Math.max(p.min, p.min + Math.round((raw - p.min) / p.step) * p.step));
    };
    // The values with one handle at v, kept minGap clear of the other.
    const withValue = (handle, v) => {
      const p = latest.current;
      return handle === "low" ? [Math.min(v, p.high - p.minGap), p.high] : [p.low, Math.max(v, p.low + p.minGap)];
    };
    const send = ([nextLow, nextHigh]) => {
      const p = latest.current;
      if (nextLow !== p.low || nextHigh !== p.high) p.onChange(nextLow, nextHigh);
    };
    // Moves the dragged handle to the finger (x), within the track and minGap
    // clear of the other handle: under the finger with `continuous`, else on
    // the closest allowed value, which is sent when it changes.
    const follow = (x) => {
      const p = latest.current;
      const d = drag.current;
      const other = d.handle === "low" ? p.high : p.low;
      const gap = (p.minGap / (p.max - p.min)) * (p.width - HANDLE);
      const [lo, hi] = d.handle === "low" ? [HANDLE / 2, centre(other) - gap] : [centre(other) + gap, p.width - HANDLE / 2];
      const clamped = Math.min(hi, Math.max(lo, x));
      const [nextLow, nextHigh] = withValue(d.handle, valueAt(clamped));
      const value = d.handle === "low" ? nextLow : nextHigh;
      pos[d.handle].setValue(p.continuous ? clamped : centre(value));
      // d.value is what was last sent, so props that have not caught up yet
      // cannot swallow a change.
      if (value !== d.value) {
        d.value = value;
        p.onChange(nextLow, nextHigh);
      }
    };
    // Pressing on a handle keeps the finger's offset from its centre; pressing
    // on the track brings the handle to the finger.
    const grab = (handle, x) => {
      const p = latest.current;
      const value = handle === "low" ? p.low : p.high;
      const d = x - centre(value);
      const onHandle = Math.abs(d) <= HANDLE / 2;
      pos[handle].stopAnimation();
      placed.current[handle] = null;
      drag.current = { handle, offset: onHandle ? d : 0, value };
      if (!onHandle) follow(x);
    };
    // Released (or interrupted): a continuous handle settles on the value it
    // was sending; a stepping one is already on it.
    const end = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.handle) placed.current[d.handle] = centre(d.value);
      if (d?.handle && latest.current.continuous) {
        Animated.timing(pos[d.handle], {
          toValue: centre(d.value),
          duration: SETTLE_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      }
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
        follow(x - drag.current.offset);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
    moveRef.current = (handle, value) => {
      const p = latest.current;
      send(withValue(handle, Math.min(p.max, Math.max(p.min, value))));
    };
  }

  const lowPct = pctOf(low);
  const highPct = pctOf(high);
  const valueText = (v) => (ticks ? ticks[Math.round((v - min) / step)] : formatLabel(v));

  // A handle is also an adjustable control for VoiceOver and TalkBack.
  const handle = (which, value) => (
    <Animated.View
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
      style={{
        width: HANDLE,
        height: HANDLE,
        left: -HANDLE / 2,
        top: (ROW - HANDLE) / 2,
        transform: [{ translateX: pos[which] }],
      }}
    />
  );
  // A value label under its handle (or under the middle of the two), moving
  // with it.
  const valueLabel = (key, x, text, wide = 1) => (
    <Animated.Text
      key={key}
      className="absolute text-xs font-medium text-red-600 text-center"
      style={{ width: LABEL_WIDTH * wide, left: -(LABEL_WIDTH * wide) / 2, transform: [{ translateX: x }] }}
    >
      {text}
    </Animated.Text>
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
            <Animated.View
              className="absolute h-0.5 bg-red-600"
              style={{ left: pos.low, width: derived.fill, top: ROW / 2 - 1 }}
            />
            {single ? null : handle("low", low)}
            {handle("high", high)}
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
              ? valueLabel("both", derived.middle, `${formatLabel(low)} – ${formatLabel(high)}`, 2)
              : [valueLabel("low", pos.low, formatLabel(low)), valueLabel("high", pos.high, formatLabel(high))]}
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
