"use client";

// Shared filter sub-components used by TopFilterBar (desktop) and mobile filter panel

import React, { useRef, useState } from "react";

export const SLIDER_CSS = `
  .px-range {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 0;
    background: transparent;
    outline: none;
    position: absolute;
  }
  .px-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px; height: 18px;
    border-radius: 50%;
    background: #ef4444;
    border: 2.5px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    cursor: pointer;
  }
  .px-range::-moz-range-thumb {
    width: 18px; height: 18px;
    border-radius: 50%;
    background: #ef4444;
    border: 2.5px solid #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,0.25);
    cursor: pointer;
  }
  .px-range-dual { pointer-events: none; }
  .px-range-dual::-webkit-slider-thumb { pointer-events: auto; }
  .px-range-dual::-moz-range-thumb  { pointer-events: auto; }
  .px-range-single { pointer-events: auto; }
`;

// Price range shared by every price slider. The right end ($4000+) means no
// upper limit, so a max of PRICE_MAX or more is stored as "".
export const PRICE_MIN = 400;
export const PRICE_MAX = 4000;
export const PRICE_STEP = 50;

export function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left mb-2"
      >
        <span className="font-semibold text-gray-900 text-sm">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function DualRangeSlider({ minRent, maxRent, setDraft, draft }) {
  const MIN = PRICE_MIN, MAX = PRICE_MAX, STEP = PRICE_STEP;
  const minVal = minRent ? Math.max(MIN, Number(minRent)) : MIN;
  const maxVal = maxRent ? Math.min(MAX, Number(maxRent)) : MAX;
  const minPct = ((minVal - MIN) / (MAX - MIN)) * 100;
  const maxPct = ((maxVal - MIN) / (MAX - MIN)) * 100;

  return (
    <div className="px-1">
      <div className="relative h-8 flex items-center">
        <div className="absolute w-full h-1.5 rounded-full bg-gray-200">
          <div
            className="absolute h-full rounded-full bg-red-500"
            style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
          />
        </div>
        <input
          type="range"
          min={MIN} max={MAX} step={STEP}
          value={minVal}
          onChange={(e) => {
            const v = Math.min(Number(e.target.value), maxVal - STEP);
            setDraft({ ...draft, minRent: v <= MIN ? "" : String(v) });
          }}
          className="px-range px-range-dual"
          style={{ zIndex: minVal > MAX - STEP ? 5 : 3 }}
        />
        <input
          type="range"
          min={MIN} max={MAX} step={STEP}
          value={maxVal}
          onChange={(e) => {
            const v = Math.max(Number(e.target.value), minVal + STEP);
            setDraft({ ...draft, maxRent: v >= MAX ? "" : String(v) });
          }}
          className="px-range px-range-dual"
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="flex justify-between text-xs mt-1">
        <span className="text-gray-400">$400</span>
        <span className="text-red-500 font-semibold text-center">
          {minVal > MIN ? `$${minVal.toLocaleString()}` : "min."}
          {" – "}
          {maxVal < MAX ? `$${maxVal.toLocaleString()}` : "$4,000+"}
        </span>
        <span className="text-gray-400">$4,000+</span>
      </div>
    </div>
  );
}

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
// label text. With ticks (one label per step, from min), every step is labelled
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
    if (
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
      onKeyDown={onKeyDown(handle, value)}
      className="absolute h-[17px] w-[17px] -translate-x-1/2 cursor-pointer rounded-full border-2 border-[#FFFBFB] bg-[#F71C1E] shadow-[0_0_3px_1px_rgba(0,0,0,0.15)] outline-none focus-visible:ring-2 focus-visible:ring-[#F71C1E]/40"
      style={{ left: handleX(pct) }}
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
        className="relative h-[17px] cursor-pointer touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="absolute inset-x-[8.5px] top-1/2 h-0.5 -translate-y-1/2 bg-gray-200" />
        <div
          className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-[#F71C1E]"
          style={{
            left: handleX(lowPct),
            width: `calc(${handleX(highPct)} - ${handleX(lowPct)})`,
          }}
        />
        {renderHandle("low", low, lowPct)}
        {renderHandle("high", high, highPct)}
      </div>
      <div className="relative mt-1 h-[21px] text-[11px] font-medium leading-[21px] text-[#F71C1E]">
        {ticks ? (
          ticks.map((text, i) => {
            const v = min + i * step;
            return label(
              pctOf(v),
              text,
              v === low || v === high ? "" : "text-gray-400"
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

export function StepSlider({ steps, value, onChange }) {
  const lastIsAny = steps[steps.length - 1]?.value === "";
  const idx = value === ""
    ? (lastIsAny ? steps.length - 1 : 0)
    : Math.max(0, steps.findIndex((s) => s.value === value));
  const pct = steps.length > 1 ? (idx / (steps.length - 1)) * 100 : 0;

  return (
    <div className="px-1">
      <div className="relative h-8 flex items-center">
        <div className="absolute w-full h-1.5 rounded-full bg-gray-200">
          <div className="absolute h-full rounded-full bg-red-500 left-0" style={{ width: `${pct}%` }} />
        </div>
        <input type="range" min={0} max={steps.length - 1} step={1} value={idx}
          onChange={(e) => onChange(steps[parseInt(e.target.value)].value)}
          className="px-range px-range-single" />
      </div>
      <div className="flex justify-between mt-1">
        {steps.map((s, i) => (
          <span
            key={i}
            onClick={() => onChange(s.value)}
            className={`text-xs leading-none cursor-pointer select-none ${idx === i ? "text-red-500 font-semibold" : "text-gray-400 hover:text-red-400"}`}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DualStepSlider({ steps, minValue, maxValue, onMinChange, onMaxChange, onSnapTo }) {
  const lastIdx = steps.length - 1;
  const minIdx = minValue === "" ? 0       : Math.max(0, steps.findIndex((s) => s.value === minValue));
  const maxIdx = maxValue === "" ? lastIdx : Math.max(0, steps.findIndex((s) => s.value === maxValue));
  const minPct = (minIdx / lastIdx) * 100;
  const maxPct = (maxIdx / lastIdx) * 100;

  return (
    <div className="px-1">
      <div className="relative h-8 flex items-center">
        <div className="absolute w-full h-1.5 rounded-full bg-gray-200">
          <div
            className="absolute h-full rounded-full bg-red-500"
            style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
          />
        </div>
        <input type="range" min={0} max={lastIdx} step={1} value={minIdx}
          onChange={(e) => {
            const i = Math.min(parseInt(e.target.value), maxIdx);
            onMinChange(steps[i].value);
          }}
          className="px-range px-range-dual"
          style={{ zIndex: minIdx >= maxIdx ? 5 : 3 }}
        />
        <input type="range" min={0} max={lastIdx} step={1} value={maxIdx}
          onChange={(e) => {
            const i = Math.max(parseInt(e.target.value), minIdx);
            onMaxChange(steps[i].value);
          }}
          className="px-range px-range-dual"
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="flex justify-between mt-1">
        {steps.map((s, i) => (
          <span
            key={i}
            onClick={() => onSnapTo ? onSnapTo(s.value) : (onMinChange(s.value), onMaxChange(s.value))}
            className={`text-xs leading-none cursor-pointer select-none ${(i === minIdx || i === maxIdx) ? "text-red-500 font-semibold" : "text-gray-400 hover:text-red-400"}`}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
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

export const DIST_STEPS = [
  { label: "10 min", value: "10" },
  { label: "15 min", value: "15" },
  { label: "20 min", value: "20" },
  { label: "30 min", value: "30" },
  { label: "45 min", value: "45" },
  { label: "Any",    value: ""   },
];

export const SHTT_STEPS = [
  { label: "2 min",  value: "2"  },
  { label: "5 min",  value: "5"  },
  { label: "10 min", value: "10" },
  { label: "20 min", value: "20" },
  { label: "Any",    value: ""   },
];
