// Occupant restrictions that landlords write in FREE-TEXT listing descriptions —
// e.g. "looking for two people (preferably women)" or "grad students only, 21+".
// The matchmaking ranker otherwise never reads `description`, so a sublease that
// only wants women, or a 21+ building, can surface for a student it can't
// actually fit. We extract the restrictions we can recognize, hard-exclude on the
// one we can verify against the student's account (gender), and surface the rest
// to the ranking model so it stops recommending obvious mismatches.
//
// Descriptions are untrusted landlord input, so this module only ever READS them
// for pattern matching — it never executes or trusts their contents.

// Words that name a gender. Word boundaries keep "male" out of "female" and "men"
// out of "women" (no boundary sits inside those words).
const FEMALE_RE = /\b(?:wom[ae]n|female[s]?|girl[s]?|ladies|lady)\b/g;
const MALE_RE = /\b(?:men|man|male[s]?|guy[s]?|gentlem[ae]n)\b/g;

// Words that signal the surrounding text is about WHO may live there (rather than
// an incidental mention like "near the women's center"). A gender word only
// counts as a restriction when one of these sits close to it.
const TENANCY_INTENT_RE =
  /\b(?:only|preferred|preferably|prefer|looking for|seeking|searching for|in search of|wanted?|needed?|sublet\w*|sublease\w*|roommate|housemate|tenant|applicant|take over|live with|move in)\b/g;

// How close (chars) a gender word must be to a tenancy-intent word to count.
const NEAR_WINDOW = 45;

// Other stated dealbreakers we can recognize. These are surfaced to the ranking
// model (not hard-filtered) so it can avoid or caveat a mismatch using whatever
// it knows about the student.
const DEALBREAKER_PATTERNS = [
  { tag: "grad students only", re: /\bgrad(?:uate)?\s+students?\s+(?:only|preferred|pref'?d)\b/i },
  { tag: "students only", re: /\bstudents?\s+only\b/i },
  { tag: "21+", re: /\b21\s*\+|\b21\s+(?:and\s+)?(?:over|older|up)\b|\bmust\s+be\s+21\b/i },
  { tag: "no pets", re: /\bno\s+pets?\b|\bpets?\s+not\s+allowed\b/i },
  { tag: "no smoking", re: /\bno\s+smoking\b|\bnon[-\s]?smok\w*\b|\bsmoke[-\s]?free\b/i },
];

// Find the single gender a description restricts occupants to, or null. Returns
// null when no gender is named in a tenancy context, AND when BOTH are (inclusive
// phrasing like "men and women welcome" is not a restriction).
function detectGenderRestriction(text) {
  const t = text.toLowerCase();
  const intentSpans = [];
  let m;
  TENANCY_INTENT_RE.lastIndex = 0;
  while ((m = TENANCY_INTENT_RE.exec(t))) intentSpans.push(m.index);
  if (!intentSpans.length) return null;

  const near = (idx) => intentSpans.some((s) => Math.abs(idx - s) <= NEAR_WINDOW);
  const genders = new Set();
  const scan = (re, gender) => {
    re.lastIndex = 0;
    let g;
    while ((g = re.exec(t))) {
      if (near(g.index)) { genders.add(gender); break; }
    }
  };
  scan(FEMALE_RE, "female");
  scan(MALE_RE, "male");
  return genders.size === 1 ? [...genders][0] : null;
}

// Memoize per listing object — extraction runs in both the eligibility filter and
// the ranker's candidate projection, over the same rows.
const _cache = new WeakMap();

// Parse a listing's description into the restrictions we can act on:
//   { gender: "female" | "male" | null, dealbreakers: string[] }
export function extractListingConstraints(listing) {
  if (!listing || typeof listing !== "object") return { gender: null, dealbreakers: [] };
  if (_cache.has(listing)) return _cache.get(listing);
  const desc = (listing.description ?? "").toString();
  let result = { gender: null, dealbreakers: [] };
  if (desc.trim()) {
    const dealbreakers = DEALBREAKER_PATTERNS.filter(({ re }) => re.test(desc)).map(({ tag }) => tag);
    result = { gender: detectGenderRestriction(desc), dealbreakers };
  }
  _cache.set(listing, result);
  return result;
}

// Short, human-readable restriction phrases for the ranking model (e.g.
// "prefers female tenants", "21+", "no pets"). Empty when nothing is restricted.
export function constraintSummary(listing) {
  const { gender, dealbreakers } = extractListingConstraints(listing);
  return [...(gender ? [`prefers ${gender} tenants`] : []), ...dealbreakers];
}

// Normalize a stored account gender ("Female"/"male"/"unspecified"/"Other"/…)
// to "female" | "male" | null. Anything we can't confidently bucket (unspecified,
// other, non-binary, blank) is null — unknown for matching purposes.
export function normalizeGender(raw) {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s) return null;
  if (/^(?:f|wom[ae]n|girl|lady|ladies)/.test(s)) return "female";
  if (/^(?:non|enby|nb|other|prefer|unspec)/.test(s)) return null;
  if (/^(?:m|guy)/.test(s)) return "male";
  return null;
}

// Read a clear FIRST-PERSON self-identification out of the student's free-text
// notes ("I'm a girl", "as a guy…"). Deliberately strict: a phrase like "looking
// for female roommates" must NOT be read as the student being female, so we only
// trust "I am/I'm/as a …" lead-ins. null when nothing clear is said.
export function inferGenderFromNotes(notes) {
  const t = (notes ?? "").toString().toLowerCase();
  if (!t) return null;
  const lead = /\b(?:i'?m|i am|as a)\b[^.!?\n]{0,24}?/;
  const fem = new RegExp(lead.source + /\b(?:female|wom[ae]n|girl|gal)\b/.source).test(t);
  const masc = new RegExp(lead.source + /\b(?:male|man|men|guy|dude)\b/.source).test(t);
  if (fem && !masc) return "female";
  if (masc && !fem) return "male";
  return null;
}

// The viewer's gender for matching: their account gender first (stamped onto the
// session preferences as `_viewerGender` by the chat route), else a clear
// first-person mention in their notes. null = unknown.
export function viewerGenderOf(preferences) {
  return normalizeGender(preferences?._viewerGender) ?? inferGenderFromNotes(preferences?.notes);
}

// Whether a listing is OFF-LIMITS to this viewer because its description restricts
// occupants to a gender the viewer is not known to be. An unknown viewer gender is
// excluded from gender-restricted listings (we can't confirm they qualify) — the
// safe call for a matchmaker. Listings with no gender restriction are always allowed.
export function isListingExcludedForViewer(listing, preferences) {
  const { gender } = extractListingConstraints(listing);
  if (!gender) return false;
  return viewerGenderOf(preferences) !== gender;
}

// Phrases that NEGATE a pet/parking need even though the keyword appears, e.g.
// "I prefer no pets" or "I won't be bringing a car". Checked first so a mention
// of the thing-they-don't-want isn't read as a requirement.
const NO_PET_RE = /\bno\s+pets?\b|without (?:the |a )?pets?|prefer(?:s)? no pets?|not bringing (?:a )?pet/;
const NO_CAR_RE = /\bno\s+car\b|without (?:a )?car|won'?t (?:be )?bring\w* (?:a )?car|do(?:n'?t| not) (?:have|need) (?:a )?(?:car|parking)/;

// Does the student's free-text "anything else?" note ask for a pet-friendly place?
// Driven entirely by the extras note (there is no dedicated pet question), so a
// student who mentions a cat/dog or "pet friendly" gets pet-friendliness factored
// into ranking. Returns false when a negation phrase is present.
export function needsPetFriendly(preferences) {
  const t = (preferences?.notes ?? "").toString().toLowerCase();
  if (!t || NO_PET_RE.test(t)) return false;
  return /\b(?:cat|cats|kitten|dog|dogs|puppy|pet|pets)\b|pet[-\s]?friendly/.test(t);
}

// Does the note ask for parking / mention bringing a car? Same extras-note source.
export function needsParking(preferences) {
  const t = (preferences?.notes ?? "").toString().toLowerCase();
  if (!t || NO_CAR_RE.test(t)) return false;
  return /\b(?:car|parking|garage)\b|parking spot|park my/.test(t);
}

// Whether a listing's free-text DESCRIPTION says pets are allowed — used to
// OVERRIDE the unreliable `pets_allowed` amenity flag, which is often left false
// for places that actually allow pets "with approval" (e.g. "cats allowed with
// permission, no dogs"). Matches a pet word followed shortly by an allow word
// (and "pet-friendly"), rejecting a directly-negated match ("no pets allowed").
// Returns false when the description explicitly bans pets. Untrusted text: only
// pattern-matched, never executed.
const PETS_OK_RE =
  /\b(?:cats?|dogs?|pets?)\b[^.!?\n]{0,24}\b(?:ok|okay|allow(?:ed)?|welcome|friendly|permitted|considered|with (?:permission|approval))\b|pet[-\s]?friendly/;
export function descriptionAllowsPets(listing) {
  const desc = (listing?.description ?? "").toString().toLowerCase();
  if (!desc) return false;
  // An explicit ban in the description wins over any positive phrasing.
  if (DEALBREAKER_PATTERNS.some(({ tag, re }) => tag === "no pets" && re.test(desc))) return false;
  const m = PETS_OK_RE.exec(desc);
  if (!m) return false;
  // Reject when a negation sits right before the matched pet phrase.
  const pre = desc.slice(Math.max(0, m.index - 8), m.index);
  return !/\b(?:no|not|cannot|can'?t)\s*$/.test(pre);
}
