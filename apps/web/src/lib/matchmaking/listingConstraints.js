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
function extractListingConstraints(listing) {
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
function normalizeGender(raw) {
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
function inferGenderFromNotes(notes) {
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
function viewerGenderOf(preferences) {
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

// ——— Sublease term evidence ———————————————————————————————————————————————
// Structured lease_term_months on sublease rows is unreliable (most carry the
// same bulk default, which satisfies every lease-length bucket), so the only
// trustworthy statement of WHEN a sublease runs is its free-text description —
// "subletting my room this summer", "June 1st thru August 15th", "August
// 2026-May 2027". Extract every duration (in months) the description explicitly
// states; empty array = no explicit term, and the matchmaking filter treats
// that as "do not offer". Untrusted text: pattern-matched only, never executed.

const MONTH_SRC =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_YEAR_SRC = "(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s*(\\d{4}))?";
// "June 1st thru August 15th", "May 25-July 31", "August 2026-May 2027", …
const MONTH_RANGE_RE = new RegExp(
  MONTH_SRC + DAY_YEAR_SRC + "\\s*(?:-|–|—|to|thru|through|until|till)\\s*(?:the\\s+end\\s+of\\s+)?" + MONTH_SRC + DAY_YEAR_SRC,
  "gi"
);
const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Season/length keywords and the duration they imply. Only counted when a
// lease-intent word sits nearby, so "great porch for the summer" is not term
// evidence but "summer sublease" is.
const TERM_KEYWORD_PATTERNS = [
  { months: 3, re: /\bsummer\b/g },
  { months: 4, re: /\bsemester\b/g },
  { months: 9, re: /\b(?:academic|school)\s+year\b/g },
  { months: 12, re: /\b(?:full|entire|whole)\s+year\b|\byear[-\s]?long\b/g },
];
const LEASE_INTENT_RE =
  /\b(?:sublease\w*|sublet\w*|lease|rent\w*|available|term|looking|seeking|take\s*over|move)\b/g;
// Wider than the gender window: term phrasing routinely puts a whole clause
// between the intent word and the season ("Subletting a room in a 3 bedroom
// duplex … over the summer").
const TERM_NEAR_WINDOW = 90;
// Explicit numeric lengths: "2 Month Lease", "a 12-month sublet".
const N_MONTH_RE = /\b(\d{1,2})\s*[-\s]?\s*months?\b/g;

const _termCache = new WeakMap();

// Every lease duration (whole months, inclusive) a listing's description
// explicitly states. Sorted, de-duplicated; [] when nothing explicit is said.
export function subleaseTermMonthsFromDescription(listing) {
  if (!listing || typeof listing !== "object") return [];
  if (_termCache.has(listing)) return _termCache.get(listing);
  const t = (listing.description ?? "").toString().toLowerCase();
  const found = new Set();
  if (t.trim()) {
    let m;
    MONTH_RANGE_RE.lastIndex = 0;
    while ((m = MONTH_RANGE_RE.exec(t))) {
      const [, startMon, startYear, endMon, endYear] = m;
      const s = MONTH_INDEX[startMon.slice(0, 3)];
      const e = MONTH_INDEX[endMon.slice(0, 3)];
      // Inclusive month count; a year jump adds whole years ("May 2026-May 2027").
      const years = startYear && endYear ? Number(endYear) - Number(startYear) : 0;
      const span = years > 0 ? years * 12 + (e - s) + 1 : ((e - s + 12) % 12) + 1;
      if (span >= 1 && span <= 24) found.add(span);
    }
    const intentIdx = [];
    LEASE_INTENT_RE.lastIndex = 0;
    while ((m = LEASE_INTENT_RE.exec(t))) intentIdx.push(m.index);
    const nearIntent = (idx) => intentIdx.some((s) => Math.abs(idx - s) <= TERM_NEAR_WINDOW);
    for (const { months, re } of TERM_KEYWORD_PATTERNS) {
      re.lastIndex = 0;
      while ((m = re.exec(t))) {
        if (nearIntent(m.index)) { found.add(months); break; }
      }
    }
    N_MONTH_RE.lastIndex = 0;
    while ((m = N_MONTH_RE.exec(t))) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 24 && nearIntent(m.index)) found.add(n);
    }
  }
  const result = [...found].sort((a, b) => a - b);
  _termCache.set(listing, result);
  return result;
}

// ——— Room-share detection ———————————————————————————————————————————————
// A "room-share" offers ONE private room inside an already-occupied unit ("we
// are two engineers looking for one more person to join our lease", "subletting
// a room in a 3 bedroom duplex", "1 bd in a 3 bd"). The structured data models
// these as a whole multi-bed unit with a per-person lease, so group sizing
// would happily tell three people they all fit — when only one bed is on offer.
// Rents are stored per person, so price math can't tell either; the only
// reliable signal is the free-text title/description. Patterns favor PRECISION
// over recall: a whole-unit listing wrongly flagged is worse than a room-share
// slipping through (the reason text still discloses roommates in most).
// Untrusted text: pattern-matched only, never executed.
const ROOM_SHARE_PATTERNS = [
  // "subletting a room in...", "renting out my room"
  /\b(?:sublett?ing|renting(?:\s+out)?)\s+(?:a|one|1|my|the)\s+(?:bed)?room\b/i,
  // "room for rent", "room to rent"
  /\b(?:bed)?room\s+(?:for|to)\s+rent\b/i,
  // "1 bd in a 3 bd", "one bedroom in a 3 bedroom"
  /\b(?:a|one|1)\s+(?:bd|bed(?:room)?)\s+in\s+an?\s+\d/i,
  // occupants seeking someone to join them
  /\bjoin\s+(?:our|my|the)\s+(?:lease|apartment|unit|house(?:hold)?)\b/i,
  /\b(?:looking|searching)\s+(?:for\s+)?(?:\w+\s+){0,2}?more\s+(?:person|people|roommates?|housemates?)\b/i,
  /\b(?:seeking|looking\s+for)\s+an?\s+(?:new\s+)?(?:roommate|housemate)\b/i,
  /\b(?:third|fourth|fifth)\s+(?:roommate|housemate)\b/i,
  /\bwill\s+have\s+\d+\s+(?:\w+\s+)?roommates?\b/i,
  /\b(?:current|existing)\s+(?:roommates?|tenants?|occupants?)\b/i,
  /\boccupants?\s+in\s+the\s+other\b/i,
  /\bspare\s+(?:bed)?room\b/i,
  /\bprivate\s+(?:bed)?room\s+in\s+an?\b/i,
];

const _roomShareCache = new WeakMap();

// Whether a listing is really one room in an occupied unit rather than a whole
// place. Group matching must treat its true capacity as ONE person, and a solo
// student picking it must be told they'd live with the current tenants.
export function isRoomShareListing(listing) {
  if (!listing || typeof listing !== "object") return false;
  if (_roomShareCache.has(listing)) return _roomShareCache.get(listing);
  const text = `${listing.title ?? ""}\n${listing.description ?? ""}`;
  const result = text.trim() ? ROOM_SHARE_PATTERNS.some((re) => re.test(text)) : false;
  _roomShareCache.set(listing, result);
  return result;
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
