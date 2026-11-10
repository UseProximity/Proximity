"use client";

// Small shared pieces for the Find Your Place pages.

const PILL = "h-9 inline-flex items-center justify-center rounded-full border text-sm font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300";

// A red answer chip. `round` is the number chips (1, 2, 3...).
export function Chip({ selected, onClick, round = false, children, ...rest }) {
  return (
    <button
      type="button"
      aria-pressed={!!selected}
      onClick={onClick}
      className={`${PILL} ${round ? "w-9" : "px-4"} ${
        selected
          ? "bg-red-600 border-red-600 text-white"
          : "bg-white border-red-300 text-red-600 hover:bg-red-50 active:bg-red-100"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

// The grey "No Preference" chip.
export function QuietChip({ selected, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={!!selected}
      onClick={onClick}
      className={`${PILL} px-4 ${
        selected
          ? "bg-gray-400 border-gray-400 text-white"
          : "bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200 hover:text-gray-500"
      }`}
    >
      {children}
    </button>
  );
}

// The white "Other" chip, before it turns into a field.
export function OtherChip({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PILL} px-4 bg-white border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500`}
    >
      {children}
    </button>
  );
}

// Pill-shaped field classes, for the rent box and the "Other" inputs.
export const FIELD = (active) =>
  `h-9 rounded-full border bg-white px-4 text-sm font-medium outline-none transition-colors placeholder:text-gray-400 focus:border-red-400 ${
    active ? "border-red-600 text-red-600" : "border-gray-200 text-gray-700"
  }`;

/*
 * One continuous bar, no number (Wyatt, 2026-11-10). `value` is 0 to 1. The
 * width is the one inline style here: it is a live value, which Tailwind
 * classes cannot express (the chat's bar did the same).
 */
export function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1 rounded-full bg-gray-100 overflow-hidden" role="presentation">
      <div className="h-full rounded-full bg-red-600 transition-all duration-500 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Question({ title, children }) {
  return (
    <section>
      <h2 className="text-[15px] font-medium text-gray-900">{title}</h2>
      <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

export function FooterButton({ primary = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 px-4 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 ${
        primary
          ? "bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

// The two-button dialog from the design ("Want to save your matches?").
export function ChoiceDialog({ title, body, quietLabel, onQuiet, primaryLabel, onPrimary }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onQuiet}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-3xl bg-white px-6 py-7 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="mt-1.5 text-sm text-gray-400">{body}</p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={onQuiet}
            className="h-9 px-5 rounded-full border border-gray-200 bg-gray-100 text-sm font-medium text-gray-500 hover:bg-gray-200"
          >
            {quietLabel}
          </button>
          <button
            type="button"
            onClick={onPrimary}
            className="h-9 px-5 rounded-full bg-red-600 text-sm font-medium text-white hover:bg-red-700"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
