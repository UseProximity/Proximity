/*
 * Find Your Place: the questions, answer options and prompt chips, shared by
 * the pages (components/findYourPlace) and the matcher (lib/findYourPlace/match.js)
 * so the two can never disagree about what an answer means.
 *
 * No server imports here: this file ships to the browser.
 */

export const NO_PREFERENCE = "No preference";
export const TEXT_MAX = 1500;
export const MATCH_COUNT = 4;

// ── Page 1 ──────────────────────────────────────────────────────────────────

export const GROUP_OPTIONS = ["1", "2", "3", "4", "5+"];
export const BIG_GROUP_MIN = 5;
export const BIG_GROUP_MAX = 12;

// `term` is the label the ranking pipeline already understands (leaseBucketTest
// in lib/matchmaking/listingFilter.js).
export const LEASE_OPTIONS = [
  { id: "semester", label: "Semester", term: "Semester only" },
  { id: "academic", label: "Academic Year (~10 mo)", term: "Academic year (~10 months)" },
  { id: "full", label: "Full Year", term: "Full year only" },
];
export const LEASE_OTHER_MIN = 1;
export const LEASE_OTHER_MAX = 24;

// The two months almost everyone moves in. 1-based month numbers.
export const MOVE_IN_CHIPS = [
  { id: "august", label: "August", month: 8 },
  { id: "january", label: "January", month: 1 },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2027-08" for the next time `month` (1-12) comes round, this month included.
export function nextOccurrence(month, today = new Date()) {
  const year = today.getFullYear() + (month < today.getMonth() + 1 ? 1 : 0);
  return `${year}-${String(month).padStart(2, "0")}`;
}

// The next 18 months as { value: "YYYY-MM", label: "August 2027" }, for "Other".
export function moveInMonthOptions(today = new Date()) {
  const out = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    out.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    });
  }
  return out;
}

export function moveInLabel(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : "";
}

// A lease opens "on or before" the move-in month when it is available by the
// LAST day of it: an August 15 opening is an August move-in.
export function moveInCutoff(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return last.toISOString().slice(0, 10);
}

/*
 * Commute modes, SLOWEST FIRST. A student picks every way they might get to
 * campus and is asked one follow-up, about the slowest of them: someone who
 * would walk or drive is asked how far they would walk.
 *
 * Shuttle asks about the walk to the stop because that is the only shuttle
 * number we hold per listing (there are no ride times or routes on file).
 */
export const COMMUTE_MODES = [
  {
    id: "walk",
    label: "Walk",
    question: "What's the longest walk to campus you'd be okay with, in minutes?",
    times: [5, 10, 15, 20],
    unit: "walk to campus",
  },
  {
    id: "bike",
    label: "Bike",
    question: "What's the longest bike ride to campus you'd be okay with, in minutes?",
    times: [5, 10, 15, 20],
    unit: "bike ride to campus",
  },
  {
    id: "shuttle",
    label: "Shuttle",
    question: "What's the longest walk to a shuttle stop you'd be okay with, in minutes?",
    times: [5, 10, 15, 20],
    unit: "walk to a shuttle stop",
  },
  {
    id: "car",
    label: "Car",
    question: "What's the longest drive to campus you'd be okay with, in minutes?",
    times: [5, 10, 20, 30],
    unit: "drive to campus",
  },
];
const MODE_IDS = COMMUTE_MODES.map((m) => m.id);

// The mode the follow-up question is about, or null when none is picked.
export function slowestMode(modes) {
  const picked = new Set(modes ?? []);
  return COMMUTE_MODES.find((m) => picked.has(m.id)) ?? null;
}

// The last time chip is open-ended ("20+"): no limit.
export const isOpenEnded = (mode, minutes) =>
  !!mode && minutes === mode.times[mode.times.length - 1];
export const timeLabel = (mode, minutes) => (isOpenEnded(mode, minutes) ? `${minutes}+` : String(minutes));

// How many of the five questions are answered (the follow-up counts with its
// parent). Drives the progress bar and the Next button.
export function answeredCount(a) {
  let n = 0;
  if (a.group) n++;
  if (a.budget === NO_PREFERENCE || Number(a.budget) > 0) n++;
  if (a.lease) n++;
  if (a.moveIn) n++;
  const mode = slowestMode(a.modes);
  if (mode && mode.times.includes(a.commuteMax)) n++;
  return n;
}
export const QUESTION_COUNT = 5;

// Clean an answers object from the client down to known values. Used by the
// API route: nothing unrecognised reaches the matcher.
export function sanitizeAnswers(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const out = { group: null, budget: null, lease: null, moveIn: null, modes: [], commuteMax: null };

  if (a.group === NO_PREFERENCE) out.group = NO_PREFERENCE;
  else {
    const n = parseInt(a.group, 10);
    if (Number.isFinite(n) && n >= 1 && n <= BIG_GROUP_MAX) out.group = String(n);
  }

  if (a.budget === NO_PREFERENCE) out.budget = NO_PREFERENCE;
  else {
    const n = Math.round(Number(a.budget));
    if (Number.isFinite(n) && n >= 100 && n <= 20000) out.budget = n;
  }

  if (a.lease === NO_PREFERENCE) out.lease = NO_PREFERENCE;
  else if (LEASE_OPTIONS.some((o) => o.id === a.lease)) out.lease = a.lease;
  else {
    const n = parseInt(a.lease, 10);
    if (Number.isFinite(n) && n >= LEASE_OTHER_MIN && n <= LEASE_OTHER_MAX) out.lease = String(n);
  }

  if (a.moveIn === NO_PREFERENCE) out.moveIn = NO_PREFERENCE;
  else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(a.moveIn ?? "")) out.moveIn = a.moveIn;

  out.modes = MODE_IDS.filter((id) => Array.isArray(a.modes) && a.modes.includes(id));
  const mode = slowestMode(out.modes);
  const max = Number(a.commuteMax);
  if (mode && mode.times.includes(max)) out.commuteMax = max;
  return out;
}

// ── Page 2 ──────────────────────────────────────────────────────────────────

/*
 * The prompts under the free-text box. Each is a labelled row with all of its
 * ideas. Three prompts show at a time (Wyatt, 2026-11-10).
 *
 * A picked idea always leaves its row, since its words are in the text box
 * now. What happens to the rest of the row depends on the prompt:
 *   - `single: true`  the ideas are mutually exclusive (furnished or not), so
 *                     one pick answers the prompt and the whole row goes.
 *                     These rows also offer "No Preference", which clears
 *                     the row without writing anything (stored as NO_PICK).
 *   - otherwise       several can apply (amenities, neighborhoods), so the
 *                     row stays with the ideas not yet picked.
 * When a row goes, or runs out, the next prompt takes its place.
 *
 * `perLine` is the most ideas one line holds (default 5). The page spreads a
 * prompt's remaining ideas evenly over as few lines as that allows and stretches each
 * line to fill the width, so no line is left holding a single chip.
 *
 * `phrase` is how an option reads inside its sentence. The sentences land in
 * the text box, where the student can edit them or keep typing: the box is what
 * gets matched on, the chips are only a way to fill it.
 */
export const PROMPTS = [
  {
    id: "neighborhood",
    label: "Neighborhood",
    single: true,
    options: [
      { id: "loop", label: "Delmar Loop", phrase: "the Delmar Loop" },
      { id: "cwe", label: "Central West End", phrase: "the Central West End" },
      { id: "clayton", label: "Clayton", phrase: "Clayton" },
      { id: "demun", label: "DeMun", phrase: "DeMun" },
      { id: "debaliviere", label: "DeBaliviere", phrase: "DeBaliviere" },
    ],
    sentence: (p) => `I'd like to live in ${orList(p)}.`,
  },
  {
    id: "furnishing",
    label: "Furnishing",
    single: true,
    options: [
      { id: "furnished", label: "Furnished", phrase: "furnished" },
      { id: "unfurnished", label: "Unfurnished", phrase: "unfurnished" },
    ],
    sentence: (p) => `I want it ${p[0]}.`,
  },
  {
    id: "amenities",
    label: "Amenities",
    options: [
      { id: "laundry", label: "In-unit laundry", phrase: "in-unit laundry" },
      { id: "parking", label: "Parking", phrase: "parking" },
      { id: "dishwasher", label: "Dishwasher", phrase: "a dishwasher" },
      { id: "ac", label: "Air conditioning", phrase: "air conditioning" },
      { id: "gym", label: "Gym", phrase: "a gym" },
      { id: "study", label: "Study spaces", phrase: "study spaces" },
      { id: "pool", label: "Pool", phrase: "a pool" },
      { id: "balcony", label: "Balcony", phrase: "a balcony" },
      { id: "utilities", label: "Utilities included", phrase: "utilities included" },
    ],
    perLine: 5,
    sentence: (p) => `I'm looking for ${andList(p)}.`,
  },
  {
    id: "priorities",
    label: "Priorities",
    options: [
      { id: "value", label: "Good value", phrase: "good value" },
      { id: "reviews", label: "Great reviews", phrase: "great reviews" },
      { id: "quiet", label: "Quiet street", phrase: "a quiet street" },
      { id: "social", label: "Social", phrase: "a social building" },
      { id: "students", label: "Near students", phrase: "being near other WashU students" },
    ],
    sentence: (p) => `What matters most to me is ${andList(p)}.`,
  },
  {
    id: "pets",
    label: "Pets",
    options: [
      { id: "cat", label: "Cat-friendly", phrase: "a cat" },
      { id: "dog", label: "Dog-friendly", phrase: "a dog" },
    ],
    sentence: (p) => `I have ${andList(p)}, so it needs to allow pets.`,
  },
  {
    id: "access",
    label: "Accessibility",
    options: [
      { id: "stepfree", label: "Step-free access", phrase: "step-free access" },
      { id: "elevator", label: "Elevator", phrase: "an elevator" },
    ],
    sentence: (p) => `I need ${andList(p)}.`,
  },
];
export const PROMPTS_AT_ONCE = 3;
// Where the page leaves the browse hand-off for /browse?fyp=1 to pick up.
export const BROWSE_HANDOFF_KEY = "prx_fyp_browse";
// The chip id a dismissed single-answer prompt is stored under.
export const NO_PICK = "none";

function andList(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function orList(items) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// The sentence one prompt's picks stand for ("" when nothing is picked).
export function promptSentence(prompt, ids) {
  const phrases = prompt.options.filter((o) => (ids ?? []).includes(o.id)).map((o) => o.phrase);
  return phrases.length ? prompt.sentence(phrases) : "";
}

// selected: { promptId: [optionId, ...] }. One sentence per prompt that has a
// pick, in prompt order, joined into the paragraph the chips stand for.
export function chipSentences(selected) {
  return PROMPTS.map((p) => promptSentence(p, selected?.[p.id])).filter(Boolean).join(" ");
}

/*
 * Apply a chip change to the text box. The prompt's old sentence is swapped for
 * its new one where it still stands; if the student has since reworded it, the
 * new sentence is added at the end and their wording is left alone.
 */
export function applyChipToText(text, prompt, beforeIds, afterIds) {
  const before = promptSentence(prompt, beforeIds);
  const after = promptSentence(prompt, afterIds);
  let next = text ?? "";
  if (before && next.includes(before)) next = next.replace(before, after);
  else if (after) next = `${next.trimEnd()} ${after}`;
  return next.replace(/[ \t]{2,}/g, " ").replace(/^ +/, "").slice(0, TEXT_MAX);
}

// Keep a chips object from the client down to known prompt and option ids.
export function sanitizeChips(raw) {
  const out = {};
  for (const prompt of PROMPTS) {
    const ids = Array.isArray(raw?.[prompt.id]) ? raw[prompt.id] : [];
    // NO_PICK is not an option, so a dismissed prompt simply drops out here.
    const known = prompt.options.filter((o) => ids.includes(o.id)).map((o) => o.id);
    if (known.length) out[prompt.id] = prompt.single ? known.slice(0, 1) : known;
  }
  return out;
}

