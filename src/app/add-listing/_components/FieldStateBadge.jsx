"use client";

const CONFIG = {
  confirmed:    { bg: "bg-green-100",  text: "text-green-700",  label: "Confirmed",   dot: "bg-green-500" },
  ai_suggested: { bg: "bg-yellow-100", text: "text-yellow-700", label: "AI",          dot: "bg-yellow-500" },
  empty:        { bg: "bg-gray-100",   text: "text-gray-500",   label: "Empty",       dot: "bg-gray-400" },
  rejected:     { bg: "bg-red-100",    text: "text-red-600",    label: "Rejected",    dot: "bg-red-500" },
};

/**
 * Small badge indicating AI-suggested / landlord-confirmed / empty / rejected state.
 * Pass `showActions` to render Confirm / Edit / Reject buttons for ai_suggested fields.
 */
export default function FieldStateBadge({
  state = "empty",
  compact = false,
  showActions = false,
  suggestedValue = null,
  onConfirm,
  onEdit,
  onReject,
}) {
  const c = CONFIG[state] ?? CONFIG.empty;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
        {c.label}
      </span>
    );
  }

  return (
    <div className={`rounded-lg border px-3 py-2 ${c.bg} ${state === "confirmed" ? "border-green-200" : state === "ai_suggested" ? "border-yellow-200" : state === "rejected" ? "border-red-200" : "border-gray-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
          <span className={`w-2 h-2 rounded-full ${c.dot}`} />
          {c.label}
          {state === "ai_suggested" && suggestedValue && (
            <span className="font-normal text-gray-600 truncate max-w-[200px]">— {suggestedValue}</span>
          )}
        </span>

        {showActions && state === "ai_suggested" && (
          <div className="flex gap-1 shrink-0">
            {onConfirm && (
              <button
                onClick={onConfirm}
                className="text-xs px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 transition"
              >
                Confirm
              </button>
            )}
            {onEdit && (
              <button
                onClick={onEdit}
                className="text-xs px-2 py-0.5 rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
              >
                Edit
              </button>
            )}
            {onReject && (
              <button
                onClick={onReject}
                className="text-xs px-2 py-0.5 rounded text-red-600 hover:text-red-700 transition"
              >
                Reject
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
