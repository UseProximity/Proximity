/*
 * Content rules for text students and landlords write into Proximity.
 *
 * Two rules, both enforced in the form (so the save button refuses) AND in the
 * API that persists the text (so a crafted request cannot walk past the form):
 *
 *   1. NO NAMES. Reviews, landlord replies and listing descriptions must not
 *      name a person. A review that says "Max never fixed the heat" identifies
 *      a real individual on a public page; "the landlord never fixed the heat"
 *      carries the same information without it.
 *   2. NO LINKS OR SELF-PROMOTION in listing descriptions. Every listing has
 *      dedicated contact name/email/phone fields, so a URL, an address, a phone
 *      number or a "visit our site to apply" in the description exists only to
 *      route students around Proximity.
 *
 * Both checks are deterministic and run client-side, so the user sees the
 * problem as they type rather than after a failed submit. See firstNames.js for
 * how the name lists are split and why.
 */

import { CLEAR_NAMES, CONTEXT_NAMES } from "@/lib/contentRules/firstNames";

// ─────────────────────────────────────────────────────────── name suppressors

// Never a person, however capitalized: months and weekdays double as names
// ("May", "June", "August") and a lease description is full of them.
const CALENDAR = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/*
 * A word that turns the token before it into an address or a building, not a
 * person: "Grant Ave", "Clayton Road", "Laurel Apartments", "Sophia Lofts".
 * This is the single most important suppressor - students and landlords write
 * about St. Louis streets constantly, and many of them are also first names.
 */
const PLACE_SUFFIX = new Set([
  "ave", "avenue", "st", "street", "rd", "road", "blvd", "boulevard", "dr",
  "drive", "ln", "lane", "pl", "place", "ct", "court", "ter", "terrace",
  "pkwy", "parkway", "way", "circle", "cir", "square", "sq", "park", "hall",
  "tower", "towers", "apartments", "apts", "apt", "lofts", "loft", "building",
  "bldg", "heights", "manor", "house", "commons", "village", "gardens",
  "estates", "residences", "plaza", "center", "centre", "city", "county",
  "university", "college", "school", "campus", "hospital", "station", "market",
  "hotel", "inn", "club", "church", "library", "mall", "bridge", "hills",
]);

const PLACE_WORDS = new Set([
  // Saint Louis and the neighborhoods, streets and landmarks every listing names.
  "louis", "saint", "ste", "missouri", "mo", "washu", "washington", "wash",
  "delmar", "loop", "clayton", "soulard", "euclid", "lindell", "forsyth",
  "waterman", "kingshighway", "skinker", "wydown", "hanley", "brentwood",
  "warson", "ladue", "kirkwood", "webster", "maplewood", "olivette", "dogtown",
  "demun", "westgate", "eastgate", "benton", "franz", "clemens", "sidney",
  "maryland", "union", "grand", "cortex", "midtown", "downtown", "danforth",
  "mckelvey", "olin", "delmonte", "divine", "foundry", "botanical", "metrolink",
  "slu", "schnucks",
  // Generic place nouns that follow a proper noun in copy and are not surnames.
  "end", "grove", "garden", "gardens", "museum", "zoo", "shuttle", "transit",
  "district", "neighborhood", "area", "side", "north", "south", "east", "west",
  "central", "city", "county", "campus", "line", "stop", "metro", "region",
]);

const TITLE = /^(mr|mrs|ms|miss|dr|prof|professor|sir|madam)\.?$/i;

/*
 * Words that, close before a capitalized token, say the token is a person:
 * either a role someone fills or a verb whose object is a person. Looked up
 * within a short window so "my landlord Max" and "asked the manager, Julie"
 * both land, while a role word two sentences back does not.
 */
const PERSON_BEFORE = new Set([
  "landlord", "landlords", "landlady", "owner", "owners", "manager", "managers",
  "management", "agent", "agents", "realtor", "broker", "superintendent",
  "super", "maintenance", "leasing", "handyman", "janitor", "roommate",
  "roommates", "tenant", "tenants", "neighbor", "neighbour", "resident",
  "receptionist", "secretary", "assistant", "staff", "worker", "plumber",
  "electrician", "contractor", "guy", "gal", "lady", "woman", "man", "dude",
  "named", "name", "call", "called", "ask", "asked", "met", "spoke", "talked",
  "emailed", "texted", "dealt", "contacted", "signed", "reported", "contact",
  "email", "text", "message", "reach", "talk", "speak",
]);

/*
 * Verbs and adverbs that, right after a capitalized token, say the token acted
 * like a person. "Max was", "Julie never", "Grant refused".
 */
const PERSON_AFTER = new Set([
  "was", "is", "were", "said", "says", "told", "tells", "never", "always",
  "refused", "refuses", "ignored", "ignores", "promised", "promises", "came",
  "comes", "showed", "shows", "kept", "keeps", "would", "wouldnt", "will",
  "wont", "did", "didnt", "does", "doesnt", "has", "hasnt", "had", "hadnt",
  "have", "got", "gets", "went", "goes", "made", "makes", "took", "takes",
  "gave", "gives", "helped", "helps", "lied", "lies", "left", "answered",
  "answers", "responded", "responds", "fixed", "fixes", "charged", "charges",
  "handled", "handles", "seemed", "seems", "treated", "treats", "stole",
  "threatened", "yelled", "emailed", "texted", "replied", "returned", "refunded",
  "claimed", "insisted", "agreed",
]);

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/*
 * Tokenize into words, remembering for each one whether a sentence boundary
 * sits immediately before it (so "Will they call?" is not read as a person) and
 * whether an apostrophe-s follows ("Max's office" is).
 */
function tokenize(text) {
  const out = [];
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text))) {
    // "Max's" arrives as one token; the name is what precedes the apostrophe-s,
    // and the apostrophe-s itself is the strongest person signal there is.
    const possessive = /['’]s$/.test(m[0]);
    const raw = possessive ? m[0].replace(/['’]s$/, "") : m[0];
    if (!raw) continue;
    const before = text.slice(0, m.index);
    out.push({
      raw,
      lower: raw.toLowerCase().replace(/['’]/g, ""),
      capitalized: /^[A-Z]/.test(raw),
      allCaps: raw.length > 1 && raw === raw.toUpperCase(),
      startsSentence: out.length === 0 || /[.!?]["')\]]?\s+$/.test(before),
      possessive,
    });
  }
  return out;
}

// A role word ("landlord", "manager", "ask for") within a few words before the
// token, without crossing a sentence boundary.
function hasRoleWordBefore(tokens, i) {
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    if (PERSON_BEFORE.has(tokens[j].lower)) return true;
    if (tokens[j].startsSentence) break;
  }
  return false;
}

function looksLikePerson(tokens, i) {
  const tok = tokens[i];
  if (tok.possessive) return true;

  const prev = tokens[i - 1];
  if (prev && TITLE.test(prev.raw)) return true;

  if (hasRoleWordBefore(tokens, i)) return true;

  const next = tokens[i + 1];
  if (next && !next.startsSentence && PERSON_AFTER.has(next.lower)) return true;

  // "Max Johnson": a capitalized token followed by another capitalized token
  // that is not a street/building word reads as a first name plus a surname.
  if (
    next &&
    !next.startsSentence &&
    next.capitalized &&
    !next.allCaps &&
    !PLACE_SUFFIX.has(next.lower) &&
    !PLACE_WORDS.has(next.lower) &&
    !CALENDAR.has(next.lower) &&
    // "Delmar Loop", "Forest Park" - a second ambiguous word means a place far
    // more often than it means a surname.
    !CONTEXT_NAMES.has(next.lower)
  ) {
    return true;
  }
  return false;
}

/**
 * Every personal name the text appears to contain, in the order they appear,
 * deduplicated. Empty array means the text is clean.
 *
 * `strict` raises the bar to an explicit person framing - a title, "named X",
 * "ask for X", or a role word right before the name. Listing descriptions use
 * it because they are marketing copy about a *place*: measured against the live
 * listings, the ordinary bar flagged Central West End, Forest Park, Tower Grove
 * and St. Louis itself, which would have blocked landlords from saving honest
 * copy. Reviews are narratives about *people*, so they use the ordinary bar.
 */
export function findNames(text, { strict = false } = {}) {
  if (!text || typeof text !== "string") return [];
  const tokens = tokenize(text);
  const hits = [];
  const seen = new Set();

  const flag = (raw) => {
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(raw);
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.capitalized || tok.allCaps) continue;
    if (tok.lower.length < 2 || CALENDAR.has(tok.lower)) continue;
    if (PLACE_WORDS.has(tok.lower)) continue;

    // "Grant Ave", "Laurel Apartments" - an address or a building, not a person.
    const next = tokens[i + 1];
    if (next && !next.startsSentence && PLACE_SUFFIX.has(next.lower)) continue;

    const prev = tokens[i - 1];

    // "St. Louis", "Saint Louis" - the city, in nearly every listing.
    if (prev && (prev.lower === "st" || prev.lower === "saint" || prev.lower === "ste")) {
      continue;
    }

    /*
     * "Mr. Alvarez", "my landlord named Kwabena", "ask for Oyelaran" - the
     * sentence says outright that this is a person, so the name lists do not
     * have to know the name. This is what catches names too uncommon to list.
     */
    const declared =
      (prev && TITLE.test(prev.raw)) ||
      (prev && !tok.startsSentence && (prev.lower === "named" || prev.lower === "for") &&
        tokens[i - 2] &&
        (tokens[i - 2].lower === "ask" ||
          tokens[i - 2].lower === "asked" ||
          PERSON_BEFORE.has(tokens[i - 2].lower)));
    if (declared && !PLACE_SUFFIX.has(tok.lower)) {
      flag(tok.raw);
      continue;
    }

    /*
     * Strict mode stops here: without an explicit "this is a person" framing,
     * a capitalized word in a listing description is a street or a building.
     */
    if (strict) {
      if (
        (CLEAR_NAMES.has(tok.lower) || CONTEXT_NAMES.has(tok.lower)) &&
        hasRoleWordBefore(tokens, i)
      ) {
        flag(tok.raw);
      }
      continue;
    }

    if (CONTEXT_NAMES.has(tok.lower)) {
      // "The Laurel", "the Chase" - a building the students named, not a person.
      if (prev && prev.lower === "the") continue;
      if (looksLikePerson(tokens, i)) flag(tok.raw);
      continue;
    }

    if (CLEAR_NAMES.has(tok.lower)) {
      // A clear name opening a sentence with no person signal around it is far
      // more often a property ("Sophia is a 4-unit building") than a landlord,
      // but "Julie was rude" must still land - PERSON_AFTER decides.
      flag(tok.raw);
    }
  }
  return hits;
}

// ──────────────────────────────────────────────── links and self-promotion

const TLD = "com|net|org|io|co|us|info|biz|site|app|xyz|me|online|live|realty|rentals|properties|apartments|homes|estate|group";

const PROMO_PATTERNS = [
  {
    type: "email",
    label: "an email address",
    re: /[a-z0-9._%+-]+\s*(?:@|\(at\)|\[at\]|\sat\s)\s*[a-z0-9.-]+\.[a-z]{2,}/i,
  },
  {
    type: "link",
    label: "a link",
    re: new RegExp(`https?:\\/\\/\\S+|\\bwww\\.[a-z0-9-]+\\.[a-z]{2,}|\\b[a-z0-9-]{2,}\\.(?:${TLD})\\b(?:\\/\\S*)?`, "i"),
  },
  {
    // "ourplace dot com", "ourplace [dot] com" - a link written to dodge a filter.
    type: "link",
    label: "a link",
    re: new RegExp(`\\b[a-z0-9-]{2,}\\s*[\\[(]?\\s*dot\\s*[\\])]?\\s*(?:${TLD})\\b`, "i"),
  },
  {
    type: "phone",
    label: "a phone number",
    re: /(?:^|[^\d])((?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4})(?!\d)/,
    group: 1,
  },
  {
    type: "handle",
    label: "a social handle",
    re: /(?:^|[\s(])(@[a-z0-9._]{2,30})\b/i,
    group: 1,
  },
  {
    type: "social",
    label: "a social media account",
    re: /\b(?:instagram|facebook|twitter|tiktok|snapchat|linkedin|whatsapp|telegram)\b/i,
  },
  {
    type: "promo",
    label: "a pitch to contact you somewhere else",
    re: /\b(?:visit|check ?out|go to|head to|see|find|browse|view|learn more (?:at|on)|more info(?:rmation)? (?:at|on)|see more (?:at|on))\s+(?:us\s+)?(?:our|my|the)\s+(?:web\s?site|site|page|portal|listing page|online listings?)\b/i,
  },
  {
    type: "promo",
    label: "a pitch to contact you somewhere else",
    re: /\b(?:contact|reach|email|call|text|message|dm|apply|book|schedule|tour)\s+(?:out\s+to\s+)?(?:us|me|our office|our team)\b/i,
  },
  {
    type: "promo",
    label: "a pitch to contact you somewhere else",
    re: /\b(?:apply|book|schedule|inquire|register|sign up|tour)\s+(?:online|through|via|on)\s+(?:our|my|the)\b/i,
  },
  {
    type: "promo",
    label: "a pitch to contact you somewhere else",
    re: /\bour\s+(?:web\s?site|website|portal|booking page|leasing page)\b/i,
  },
];

/**
 * The first promotional problem in the text, or null. Reports one at a time on
 * purpose: fixing it often removes the rest, and a wall of violations reads as
 * an accusation rather than a correction.
 */
export function findPromo(text) {
  if (!text || typeof text !== "string") return null;
  for (const { type, label, re, group } of PROMO_PATTERNS) {
    const m = text.match(re);
    if (m) return { type, label, match: (m[group ?? 0] ?? m[0]).trim() };
  }
  return null;
}

// ───────────────────────────────────────────────────────────── public checks

function nameMessage(names, alternative) {
  const shown = names.slice(0, 3).map((n) => `“${n}”`);
  const quoted =
    shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
  const more = names.length > 3 ? ` (plus ${names.length - 3} more)` : "";
  return `Please don't name people. Remove ${quoted}${more}, then ${alternative}`;
}

/** Error message for a review or a landlord reply, or null when it's fine. */
export function checkReviewText(text) {
  const names = findNames(text);
  if (!names.length) return null;
  return nameMessage(
    names,
    "describe the role instead, like “the landlord” or “the property manager”."
  );
}

/** Error message for a listing description, or null when it's fine. */
export function checkListingDescription(text) {
  const names = findNames(text, { strict: true });
  if (names.length) {
    return nameMessage(names, "describe the role instead, like “the leasing office”.");
  }
  const promo = findPromo(text);
  if (promo) {
    return `Descriptions can't include ${promo.label}. Remove “${promo.match}” and use the contact fields instead, so students reach you through Proximity.`;
  }
  return null;
}
