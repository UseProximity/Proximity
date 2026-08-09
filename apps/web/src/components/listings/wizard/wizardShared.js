"use client";

/*
 * Tiny shared pieces for the add-listing wizard steps: one look for chips,
 * labels, and the step frame so every screen feels like the same product.
 */

export function Chip({ on, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-2 rounded-full text-sm font-medium border transition-colors ${
        on
          ? "bg-red-600 text-white border-red-600"
          : "bg-white text-gray-700 border-gray-300 hover:border-red-400"
      }`}
    >
      {children}
    </button>
  );
}

export function FieldLabel({ children, optional }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}
      {optional && <span className="ml-1 font-normal text-gray-400">(optional)</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

// Amber tint for values imported from the landlord's website, cleared on touch.
export const importedInputCls = " ring-1 ring-amber-400 bg-amber-50";

// Plus/minus stepper (Airbnb-style) — no typing for counts.
export function Stepper({ value, onChange, min = 0, step = 1, format }) {
  const v = value === "" ? null : Number(value);
  const show = v == null ? "—" : format ? format(v) : String(v);
  const btn =
    "flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 transition-colors hover:border-red-400 hover:text-red-600 disabled:opacity-30 disabled:hover:border-gray-300 disabled:hover:text-gray-600";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="decrease"
        className={btn}
        disabled={v == null || v <= min}
        onClick={() => onChange(Math.max(min, (v ?? min) - step))}
      >
        −
      </button>
      <span className="min-w-8 text-center text-sm font-semibold text-gray-900">
        {show}
      </span>
      <button
        type="button"
        aria-label="increase"
        className={btn}
        onClick={() => onChange(v == null ? Math.max(min, step) : v + step)}
      >
        +
      </button>
    </div>
  );
}

/*
 * One wizard screen: a big question, optional one-line reassurance, content,
 * and nothing else. Keeping every screen in this frame is what makes the flow
 * feel light.
 */
export function StepFrame({ title, subtitle, children }) {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900">{title}</h2>
      {subtitle && <p className="mt-1.5 text-sm text-gray-500">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}
