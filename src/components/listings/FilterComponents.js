"use client";

// Shared filter sub-components used by TopFilterBar (desktop) and mobile filter panel

import React, { useState } from "react";

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
  const MIN = 400, MAX = 5000, STEP = 50;
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
