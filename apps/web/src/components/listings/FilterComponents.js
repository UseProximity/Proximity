"use client";

// Shared parts of the browse filters: the price range, the bed and bath steps,
// the card shell and the range sliders. The Price and Beds & Baths cards (the
// desktop bar) and the side panel (desktop, and the phone's filter drawer) are
// built from them.

import { useRef } from "react";

// Price range shared by every price slider. The right end ($4000+) means no
// upper limit, so a max of PRICE_MAX or more is stored as "".
export const PRICE_MIN = 400;
export const PRICE_MAX = 4000;
export const PRICE_STEP = 50;

// Shell of the pink-header filter cards (Price, Beds & Baths): title band,
// body and the red Apply pill. onApply is called when Apply is pressed.
export function FilterCard({ title, onApply, children }) {
  return (
    <div className="w-80 overflow-hidden rounded-[28px] border border-gray-300 bg-white shadow-xl">
      <h3 className="bg-[#ffefef] px-6 py-3.5 text-[17px] font-semibold leading-[21px] text-black">
        {title}
      </h3>
      <div className="pb-4">
        {children}
        <button
          onClick={onApply}
          className="mx-auto mt-4 block h-7 w-[84px] rounded-full bg-[#F00013] text-[17px] text-white transition-opacity hover:opacity-90"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// Handle size in px. A handle's centre sits at handleX(pct), which keeps the
// first and last handle inside the track (half a handle in from each end).
const HANDLE_PX = 17;
const handleX = (pct) => `calc(${pct}% + ${(0.5 - pct / 100) * HANDLE_PX}px)`;
// Labels whose handles are closer than this (% of the track) merge into one.
const LABEL_MERGE_PCT = 16;

// Two-handle range slider in the Browse Listings design: a red track between
// round red handles, with a red label under each. low and high are numbers
// between min and max, at least one step apart; formatLabel(value) gives the
// label text. accent is the red of handles, track and labels. With single, only
// the high handle shows and the track runs from the left end to it (pass low as
// min). With ticks (one label per step, from min), every step is labelled
// instead, the selected ones in red, and formatLabel is not needed. minGap is how
// close the handles may get (default one step; 0 lets them meet).
//
// Dragging is handled here with pointer events rather than two overlaid
// <input type="range">. With those, the browser's hit-testing and z-order
// decided which handle moved, so handles close together could not be told
// apart (the wrong one moved, or one stuck behind the other), and the clamping
// fought the native drag value. Here the handle is chosen once, on press, and
// then follows the pointer, clamped a step clear of the other handle.
export function RangeSlider({
  min,
  max,
  step = 1,
  minGap = step,
  accent = "#F71C1E",
  single = false,
  low,
  high,
  onChange,
  formatLabel,
  ticks,
}) {
  const rowRef = useRef(null);
  // Drag in progress: { handle, offset, startX }. handle is null until known.
  const drag = useRef(null);
  const pctOf = (v) => ((v - min) / (max - min)) * 100;
  const lowPct = pctOf(low);
  const highPct = pctOf(high);

  // Client x of a handle's centre, and the step-snapped value under a client x.
  const centreX = (v) => {
    const r = rowRef.current.getBoundingClientRect();
    return r.left + HANDLE_PX / 2 + (pctOf(v) / 100) * (r.width - HANDLE_PX);
  };
  const valueAt = (x) => {
    const r = rowRef.current.getBoundingClientRect();
    const raw =
      min + ((x - r.left - HANDLE_PX / 2) / (r.width - HANDLE_PX)) * (max - min);
    return min + Math.round((raw - min) / step) * step;
  };
  // Moves a handle, keeping it on the track and minGap clear of the other one.
  const move = (handle, value) => {
    const v = Math.min(max, Math.max(min, value));
    if (handle === "low") onChange(Math.min(v, high - minGap), high);
    else onChange(low, Math.max(v, low + minGap));
  };
  // Starts dragging a handle pressed at client x. Pressing on the handle keeps
  // the pointer's offset from its centre; pressing on the track jumps it there.
  const grab = (handle, x) => {
    const d = x - centreX(handle === "low" ? low : high);
    const onHandle = Math.abs(d) <= HANDLE_PX / 2;
    drag.current = { handle, offset: onHandle ? d : 0 };
    if (!onHandle) move(handle, valueAt(x));
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = e.clientX;
    const lowX = centreX(low);
    const highX = centreX(high);
    if (single) {
      grab("high", x);
    } else if (
      Math.abs(x - lowX) <= HANDLE_PX / 2 &&
      Math.abs(x - highX) <= HANDLE_PX / 2
    ) {
      // Both handles are under the pointer: the first move decides which one.
      drag.current = { handle: null, startX: x };
    } else {
      grab(Math.abs(x - lowX) <= Math.abs(x - highX) ? "low" : "high", x);
    }
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    if (!drag.current.handle) {
      const { startX } = drag.current;
      if (Math.abs(e.clientX - startX) < 2) return;
      grab(e.clientX < startX ? "low" : "high", startX);
    }
    move(drag.current.handle, valueAt(e.clientX - drag.current.offset));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (handle, value) => (e) => {
    const dir = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    move(handle, value + dir * step);
  };

  const renderHandle = (handle, value, pct) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={handle === "low" ? "Minimum" : "Maximum"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={ticks ? ticks[Math.round((value - min) / step)] : formatLabel(value)}
      onKeyDown={onKeyDown(handle, value)}
      className="absolute h-[17px] w-[17px] -translate-x-1/2 cursor-pointer rounded-full border-2 border-[#FFFBFB] shadow-[0_0_3px_1px_rgba(0,0,0,0.15)] outline-none focus-visible:ring-2 focus-visible:ring-red-300"
      style={{ left: handleX(pct), backgroundColor: accent }}
    />
  );
  const label = (pct, text, color = "") => (
    <span
      key={text}
      className={`absolute -translate-x-1/2 whitespace-nowrap ${color}`}
      style={{ left: handleX(pct) }}
    >
      {text}
    </span>
  );

  return (
    <div>
      <div
        ref={rowRef}
        // The ::before is not drawn: it makes the row 12px taller above and below
        // for a finger, without moving anything.
        className="relative h-[17px] cursor-pointer touch-none select-none before:absolute before:inset-x-0 before:-inset-y-3"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="absolute inset-x-[8.5px] top-1/2 h-0.5 -translate-y-1/2 bg-gray-200" />
        <div
          className="absolute top-1/2 h-0.5 -translate-y-1/2"
          style={{
            backgroundColor: accent,
            left: handleX(lowPct),
            width: `calc(${handleX(highPct)} - ${handleX(lowPct)})`,
          }}
        />
        {!single && renderHandle("low", low, lowPct)}
        {renderHandle("high", high, highPct)}
      </div>
      <div
        className="relative mt-1 h-[21px] text-[11px] font-medium leading-[21px]"
        style={{ color: accent }}
      >
        {ticks ? (
          ticks.map((text, i) => {
            const v = min + i * step;
            return label(
              pctOf(v),
              text,
              v === high || (!single && v === low) ? "" : "text-gray-400"
            );
          })
        ) : highPct - lowPct < LABEL_MERGE_PCT ? (
          label(
            (lowPct + highPct) / 2,
            `${formatLabel(low)} – ${formatLabel(high)}`
          )
        ) : (
          <>
            {label(lowPct, formatLabel(low))}
            {label(highPct, formatLabel(high))}
          </>
        )}
      </div>
    </div>
  );
}

// Index of a filter value in steps ({ label, value }). "" (the open end), or a
// value the steps do not offer, gives fallback.
export const stepIndex = (steps, value, fallback) => {
  const i = value ? steps.findIndex((s) => s.value === value) : -1;
  return i < 0 ? fallback : i;
};

// Filter strings for a range of step indexes: "" at either end means no limit.
export const stepLimits = (steps, { low, high }) => [
  low === 0 ? "" : steps[low].value,
  high === steps.length - 1 ? "" : steps[high].value,
];

// RangeSlider over named steps, labelling every step. low and high are step
// indexes and may be equal; with single only high is used.
export function StepRange({ steps, low = 0, high, single, accent, onChange }) {
  return (
    <RangeSlider
      min={0}
      max={steps.length - 1}
      minGap={0}
      accent={accent}
      single={single}
      low={low}
      high={high}
      onChange={onChange}
      ticks={steps.map((s) => s.label)}
    />
  );
}

export const BED_STEPS = [
  { label: "0",  value: "0" },
  { label: "1",  value: "1" },
  { label: "2",  value: "2" },
  { label: "3",  value: "3" },
  { label: "4",  value: "4" },
  { label: "5+", value: "5" },
];

export const BATH_STEPS = [
  { label: "1",   value: "1"   },
  { label: "1.5", value: "1.5" },
  { label: "2",   value: "2"   },
  { label: "2.5", value: "2.5" },
  { label: "3",   value: "3"   },
  { label: "4+",  value: "4"   },
];
