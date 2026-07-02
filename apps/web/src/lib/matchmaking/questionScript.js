// The matchmaking question flow is a FIXED, deterministic script. Each entry is
// rendered instantly client-side as tappable option chips — no LLM decides what
// to ask. `prompt` is the exact phrasing shown; `field` is the canonical
// preference key (a few questions write to multiple keys — see isAnswered).
export const QUESTION_PLAN = [
  {
    id: "name_confirm",
    field: "name",
    kind: "confirm_or_replace",
    prompt:
      "Hi there, I'm Proxy, your personal housing matchmaker. Let's find your place. First, I have your name as {{name}}. Is that right, or do you go by something else?",
  },
  {
    id: "program",
    field: "program",
    kind: "choice",
    prompt: "Which program are you in?",
    options: ["Undergrad", "Grad", "Med", "Law", "Business", "Other"],
  },
  {
    // Asked instead of "what year" so it stays unambiguous when we test/launch
    // over the summer (when "rising junior" vs "junior" is unclear) and tells us
    // how long this student stays a warm lead. Not used by the ranker.
    id: "grad_year",
    field: "grad_year",
    kind: "choice",
    prompt: "When do you graduate?",
    options: ["2026", "2027", "2028", "2029", "2030+"],
  },
  {
    id: "group_size",
    field: "group_size",
    kind: "choice",
    prompt: "How many people are you planning to live with (including you)?",
    // Tappable count cards; "6+" submits "6+" (parseGroupRange reads it as "at
    // least 6"). answerToLabel renders the pick as "3 people" / "1 person".
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
    kind: "multi",
    prompt: "What lease length works for you? Pick all that fit.",
    options: ["Semester only", "Academic year (~10 months)", "Full year only"],
    allowUnsure: true,
  },
  {
    id: "move_in_window",
    field: "move_in_month",
    kind: "month_select",
    prompt: "When are you looking to move in?",
    // Two prominent chips; everything else lives in the "Other month" dropdown.
    options: ["August (start of the year)", "January (spring semester)"],
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
    id: "priorities",
    // Multi-select: the student taps everything that matters to them (in tap
    // order, which we treat as importance — see the priorities weighting in
    // applyAnswer). The drag-to-rank in PreferencePanel fine-tunes the order
    // afterward. The real fine-grained narrowing happens after this, via the
    // listing-aware "Would you X for Y?" tradeoff questions (see narrowing.js).
    field: "priorities",
    kind: "multi",
    prompt: "What matters most in your place? Tap everything that fits.",
    options: ["Close to campus", "Good value", "Great reviews", "Amenities", "Quiet/study", "Social/parties", "Close to other WashU students"],
    allowUnsure: true,
  },
  {
    id: "extras",
    field: "notes",
    kind: "open_text",
    prompt:
      "Last thing: anything else I should factor in? Must-haves, dealbreakers, vibe, a specific street… tell me anything, or just say you're good.",
    placeholder: "e.g. in-unit laundry is a must, no busy roads…",
  },
];

// Sentinel submitted when a user taps an "unsure / no preference" option.
export const UNSURE = "__unsure__";

// Cap on the narrowing phase's "Would you X for Y?" tradeoff questions. Lives
// here (not narrowing.js, which imports the Anthropic SDK) so the client can
// size the progress bar off the same number the server enforces.
export const MAX_TRADEOFFS = 4;

// Render a group-size value as people-friendly text: "1 person", "3 people",
// "6+ people". Used for the chat bubble and the answers panel.
export function peopleLabel(value) {
  const s = String(value ?? "").trim();
  if (!s || s === "No preference") return s;
  const n = parseInt(s.replace(/\+/g, ""), 10);
  return `${s} ${n === 1 ? "person" : "people"}`;
}

export const QUESTION_BY_ID = Object.fromEntries(QUESTION_PLAN.map((q) => [q.id, q]));

// Direct answer→weight bumps (applied deterministically server- and client-side).
export const WEIGHT_MAP = {
  budget:     { budget: 0.7 },
  area:       { neighborhood: 1.0, walkability: 0.3 },
  lease_term: { lease_flexibility: 0.6 },
  furnished:  { amenities: 0.3 },
};

// Each priority label maps to the weight dimensions it implies. Higher-ranked
// priorities get a bigger bump in order — see RANK_BUMPS.
export const PRIORITY_WEIGHTS = {
  "Close to campus": ["walkability", "location"],
  "Good value": ["value", "budget"],
  "Great reviews": ["reviews"],
  "Amenities": ["amenities"],
  // "Quiet/study" has no dedicated data column; the closest real signal is the
  // study_room amenity (and amenity richness generally), so map it there instead
  // of leaving it a complete no-op that ignored the priority entirely.
  "Quiet/study": ["amenities"],
  "Social/parties": ["social"],
  "Close to other WashU students": ["social", "group_fit"],
};

// Rank-position → weight bump for the priorities ranking (index 0 = top choice).
// Steep contrast on purpose: the #1 priority should clearly dominate the ranking
// so students who prioritize different things get meaningfully different matches,
// instead of one strong all-rounder winning for everyone.
export const RANK_BUMPS = [1.0, 0.5, 0.3, 0.18, 0.1, 0.06, 0.04];

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
    // Priorities answered once the student has picked at least one (the array is
    // filled), or marked unsure (no preference).
    case "priorities":
      return isFilled(p.priorities) || !!p._priorities_unsure;
    // Open-ended extras: answered once submitted or skipped.
    case "extras":
      return !!p._extras_done;
    default:
      return isFilled(p[question.field]);
  }
}
