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
    id: "group_size",
    field: "group_size",
    kind: "choice",
    // Uses the name we just confirmed, so the flow reads as a handoff from the
    // greeting straight into the first real question.
    prompt: "Alright {{name}}, how many people are you planning to live with (including yourself)?",
    // Tappable count cards, ascending from 0 bedrooms. Every count is EXACT: tap
    // 2 and you get 2-bedroom places, never a 3-bed you'd be paying an extra room
    // for. "Studio" means one person in a 0-bedroom unit and matches ONLY studios.
    // No single unit on the market has 5+ bedrooms, so "5+" needs real numbers to
    // match a flush combination of units (see expandCount): tapping it swaps the
    // chip row for MIN and MAX fields, and the student submits "6" or "5-7".
    // answerToLabel renders the pick as "Studio" / "1 person" / "5-7 people".
    options: ["Studio", "1", "2", "3", "4", "5+"],
    expandCount: true,
    // A headcount is a closed set — there is no sensible free-text answer, so no
    // "Something else…" escape hatch on this one.
    noOther: true,
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
    // Single-select: a student signs one lease, so this is a decision rather than
    // a shortlist. (leaseTestsFor accepts a scalar or an array, so sessions
    // answered before this change still rank correctly.)
    kind: "choice",
    prompt: "What lease length works for you?",
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
    // Multi-select: the student taps everything that matters to them. Tap order
    // deliberately does NOT matter — every stated priority weighs the same
    // (binary weights, see applyAnswer). The single headline anchor comes from
    // the top_priority follow-up below. The real fine-grained narrowing happens
    // via the listing-aware "Would you X for Y?" tradeoffs (see narrowing.js).
    field: "priorities",
    kind: "multi",
    prompt: "What are you looking for in a home? Tap all that matter to you.",
    options: ["Close to campus", "Good value", "Great reviews", "Amenities", "Quiet/study", "Social/parties", "Close to other WashU students"],
    allowUnsure: true,
  },
  {
    id: "top_priority",
    // Conditional follow-up, only asked when the student picked 2+ priorities
    // (see isAnswered): one tap names the single priority the #1 card must be
    // built around. This replaces the old tap-order ranking as the headline
    // anchor. Options are the student's own picks (see describeQuestion).
    field: "top_priority",
    kind: "choice",
    prompt: "Of those priorities, which one matters most?",
    options: null, // filled from preferences.priorities at render time
    optionsFromPriorities: true,
    allowUnsure: true,
  },
  {
    id: "extras",
    field: "notes",
    kind: "open_text",
    prompt:
      "Anything else I should factor in? Must-haves, dealbreakers, vibe, a specific street… tell me anything, or just say you're good.",
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
  // "Studio" is a place, not a headcount — it reads for itself.
  if (/^studio$/i.test(s)) return "Studio";
  const n = parseInt(s.replace(/\+/g, ""), 10);
  return `${s} ${n === 1 ? "person" : "people"}`;
}

export const QUESTION_BY_ID = Object.fromEntries(QUESTION_PLAN.map((q) => [q.id, q]));

// Direct answer→weight bumps (applied deterministically server- and client-side).
// BINARY by design: a stated preference weighs 1, no preference weighs 0. The
// relative importance between dimensions is decided downstream (headline anchor
// + the ranking LLM), never by hand-tuned magnitudes here. Note `furnished` is
// its own dimension backed by listings.furnished — it is NOT an amenity.
export const WEIGHT_MAP = {
  budget:     { budget: 1 },
  area:       { neighborhood: 1 },
  lease_term: { lease_flexibility: 1 },
  furnished:  { furnished: 1 },
};

// Each priority label maps to the weight dimensions it implies. Every stated
// priority gets the same binary weight of 1 (see applyAnswer) — the headline
// anchor (top_priority) is what differentiates emphasis, not magnitudes.
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
    // Conditional: only asked when 2+ priorities were picked (with 0–1 there is
    // nothing to choose between — the single pick IS the anchor). "Not sure"
    // stores "No preference", which isFilled treats as answered.
    case "top_priority":
      return (p.priorities?.length ?? 0) < 2 || isFilled(p.top_priority);
    // Open-ended extras: answered once submitted or skipped.
    case "extras":
      return !!p._extras_done;
    default:
      return isFilled(p[question.field]);
  }
}
