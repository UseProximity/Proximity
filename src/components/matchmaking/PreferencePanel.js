"use client";

const FIELD_LABELS = {
  name: "Name",
  year_of_school: "Year",
  group_size: "Group size",
  budget_max: "Max rent ($/mo)",
  area: "Preferred area",
  lease_term: "Lease term",
  move_in_month: "Move-in",
  furnished: "Furnished",
  commute: "Commute",
  priorities: "Priorities",
  notes: "Other notes",
};

// Read-only summary of the answers Proxy has collected. Editing happens in the
// chat via the "Edit from here" button on each prompt — not here.
export default function PreferencePanel({ preferences }) {
  const rows = Object.entries(preferences ?? {})
    .filter(([k, v]) => {
      if (k.startsWith("_")) return false; // internal flags
      if (v === null || v === undefined || v === "") return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return FIELD_LABELS[k]; // only show known, user-facing fields
    })
    .sort(([a], [b]) => Object.keys(FIELD_LABELS).indexOf(a) - Object.keys(FIELD_LABELS).indexOf(b));

  const display = (field, value) => {
    if (field === "budget_max") return `$${value}`;
    if (field === "priorities" && Array.isArray(value)) return value.map((v, i) => `${i + 1}. ${v}`).join(", ");
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">Your answers</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Use “Edit from here” in the chat to change any answer.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No answers collected yet.</p>
        ) : (
          rows.map(([field, value]) => (
            <div
              key={field}
              className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0 gap-2"
            >
              <span className="text-xs text-gray-500 w-28 flex-shrink-0 pt-0.5">
                {FIELD_LABELS[field] ?? field}
              </span>
              <span className="flex-1 text-right text-xs text-gray-700">{display(field, value)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
