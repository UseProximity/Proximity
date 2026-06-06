// The matchmaking question flow is a FIXED, deterministic script. Each entry is
// rendered instantly client-side as tappable option chips — no LLM decides what
// to ask. `prompt` is the exact phrasing shown; `field` is the canonical
// preference key (a few questions write to multiple keys — see isAnswered).
export const QUESTION_PLAN = [
  {
    id: "name_confirm",
    field: "name",
    kind: "confirm_or_replace",
    prompt: "I've got your name as {{name}} — that right, or do you go by something else?",
  },
  {
    id: "year",
    field: "year_of_school",
    kind: "choice",
    prompt: "What year are you?",
    options: ["Freshman", "Sophomore", "Junior", "Senior", "Grad", "Med", "Other"],
  },
  {
    id: "group_size",
    field: "group_size",
    kind: "choice",
    prompt: "How many people are you looking to live with (including you)?",
    options: ["1", "2", "3", "4", "5", "6+"],
    allowUnsure: true,
  },
  {
    id: "budget",
    field: "budget",
    kind: "budget_max",
    prompt: "What's your max monthly rent per person?",
    maxLabel: "Max $/mo",
    allowUnsure: true,
  },
  {
    id: "area",
    field: "area",
    kind: "multi",
    prompt: "Any neighborhoods you're drawn to? Pick all that fit.",
    options: ["The Loop", "Central West End", "Clayton", "DeMun", "DeBaliviere", "No preference"],
  },
  {
    id: "lease_term",
    field: "lease_term",
    kind: "choice",
    prompt: "What lease length works for you?",
    options: ["Semester only", "Full year only", "Open to either"],
    allowUnsure: true,
  },
  {
    id: "move_in_window",
    field: "move_in_month",
    kind: "month_select",
    prompt: "When are you looking to move in?",
    // Two prominent chips; everything else lives in the "Other month" dropdown.
    options: ["August — start of the year", "January — spring semester"],
    others: ["September", "October", "November", "December", "February", "March", "April", "May", "June", "July"],
    allowUnsure: true,
  },
  {
    id: "furnished",
    field: "furnished",
    kind: "yesno_pref",
    prompt: "Do you want a furnished place?",
    options: ["Yes", "No", "No preference"],
  },
  {
    id: "commute",
    field: "commute",
    kind: "multi",
    prompt: "How do you plan to get to campus? Pick all that apply.",
    options: ["Walk", "Bike", "Drive", "Transit"],
    allowUnsure: true,
  },
  {
    id: "priorities",
    // Reliable-mode adaptive pairwise ranking: a series of "Which matters more,
    // A or B?" questions builds the top-3 from prior signal in as few taps as
    // possible (see questionEngine pairwise* helpers). The drag-to-rank survives
    // as the editor in PreferencePanel for fine-tuning afterward.
    field: "priorities",
    kind: "pairwise_rank",
    prompt: "A couple quick either/or questions to see what matters most.",
    options: ["Close to campus", "Good value", "Great reviews", "Amenities", "Quiet/study", "Social/parties", "Close to other WashU students"],
    allowUnsure: true,
  },
  {
    id: "extras",
    field: "notes",
    kind: "open_text",
    prompt:
      "Last thing — anything else I should factor in? Must-haves, dealbreakers, vibe, a specific street… tell me anything, or just say you're good.",
    placeholder: "e.g. in-unit laundry is a must, no busy roads…",
  },
];

// Sentinel submitted when a user taps an "unsure / no preference" option.
export const UNSURE = "__unsure__";

export const QUESTION_BY_ID = Object.fromEntries(QUESTION_PLAN.map((q) => [q.id, q]));

// Direct answer→weight bumps (applied deterministically server- and client-side).
export const WEIGHT_MAP = {
  budget:     { budget: 0.7 },
  area:       { location: 0.7, walkability: 0.4 },
  lease_term: { lease_flexibility: 0.6 },
  furnished:  { amenities: 0.3 },
  commute:    { walkability: 0.6 },
};

// Each priority label maps to the weight dimensions it implies. Higher-ranked
// priorities get a bigger bump in order — see RANK_BUMPS.
export const PRIORITY_WEIGHTS = {
  "Close to campus": ["walkability", "location"],
  "Good value": ["value", "budget"],
  "Great reviews": ["reviews"],
  "Amenities": ["amenities"],
  "Quiet/study": [],
  "Social/parties": ["social"],
  "Close to other WashU students": ["social", "group_fit"],
};

// Rank-position → weight bump for the priorities ranking (index 0 = top choice).
export const RANK_BUMPS = [0.9, 0.75, 0.6, 0.45, 0.3, 0.2, 0.15];

const isFilled = (v) =>
  v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

// Whether a question has been answered. Most read a single `field`; `budget`
// writes to the canonical `budget_max` key.
export function isAnswered(question, preferences) {
  const p = preferences ?? {};
  switch (question.id) {
    // `name` is pre-filled at session creation, so gate on an explicit
    // confirmation flag — we always want to ask/confirm it first.
    case "name_confirm":
      return !!p._name_confirmed;
    // Budget can be answered with a number or marked unsure (no cap).
    case "budget":
      return isFilled(p.budget_max) || !!p._budget_unsure;
    // Priorities answered once the pairwise flow finishes (or a ranking exists,
    // e.g. from a panel edit / rewind replay), or marked unsure (no ranking).
    case "priorities":
      return !!p._pairwise?.done || isFilled(p.priorities) || !!p._priorities_unsure;
    // Open-ended extras: answered once submitted or skipped.
    case "extras":
      return !!p._extras_done;
    default:
      return isFilled(p[question.field]);
  }
}
