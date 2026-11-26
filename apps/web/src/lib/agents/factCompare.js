/*
 * Comparing a fact with a new statement of it: the pure part of the weekly
 * read's write step (synthesize.js applyProposals) and of the student
 * correction notes (corrections.js). No database and no model here, so
 * node --test can import it on its own (factCompare.test.js); that is also
 * why this file imports nothing.
 */

/*
 * The amounts, times and dates in a sentence, written one way whatever way
 * the page wrote them (PR 478 review): "9am" and "9:00 AM", "1st" and
 * "first", "twenty-four" and "24", "12/1" and "December 1" are the same
 * thing, so a page that only reformats a time or a date is not a change.
 * Times become t<hour 0-23>:<minutes>, dates d<month>/<day>[/<year>], a month
 * on its own m<month>, anything else its plain number.
 */
const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?";
const monthNo = (m) => MONTHS[m.slice(0, 3)];
const year = (y) => (!y ? "" : `/${y.length === 2 ? `20${y}` : y}`);

const UNIT_WORD = Object.keys(UNITS).join("|");
const TENS_WORD = Object.keys(TENS).join("|");
const ORD_WORD = Object.keys(ORDINALS).join("|");
// "twenty-four", "twenty four", "twenty-first", "one hundred fifty", "eight".
const WORD_NUMBER = new RegExp(`\\b(?:(${UNIT_WORD})[- ]hundred(?:[- ](?:and[- ])?)?)?(?:(${TENS_WORD})(?:[- ](${UNIT_WORD}|${ORD_WORD}))?|(${UNIT_WORD}|${ORD_WORD}))\\b|\\b(${UNIT_WORD})[- ]hundred\\b`, "g");

function wordsToDigits(text) {
  return text.replace(WORD_NUMBER, (all, hundreds, tens, tail, single, onlyHundreds) => {
    if (onlyHundreds) return String(UNITS[onlyHundreds] * 100);
    let n = hundreds ? UNITS[hundreds] * 100 : 0;
    if (tens) n += TENS[tens] + (tail ? UNITS[tail] ?? ORDINALS[tail] : 0);
    else if (single) n += UNITS[single] ?? ORDINALS[single];
    return String(n);
  });
}

const hour24 = (h, suffix) => {
  const pm = /^p/.test(suffix);
  const n = Number(h) % 12;
  return pm ? n + 12 : n;
};
const time = (h, m, suffix) => `t${suffix ? hour24(h, suffix) : Number(h)}:${String(Number(m ?? 0)).padStart(2, "0")}`;

export function numberTokens(text) {
  const tokens = [];
  const take = (re, fn) => { s = s.replace(re, (...m) => { tokens.push(fn(...m)); return " "; }); };
  let s = wordsToDigits(String(text ?? "").toLowerCase())
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/\bnoon\b/g, "12pm").replace(/\bmidnight\b/g, "12am");
  // Dates: 2026-12-01, December 1(st), 2026, 1 December, 12/1(/26).
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_, y, mo, d) => `d${Number(mo)}/${Number(d)}/${y}`);
  take(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})\\b(?:,?\\s+(\\d{4})\\b)?`, "g"), (_, mo, d, y) => `d${monthNo(mo)}/${Number(d)}${year(y)}`);
  take(new RegExp(`\\b(\\d{1,2})\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4})\\b)?`, "g"), (_, d, mo, y) => `d${monthNo(mo)}/${Number(d)}${year(y)}`);
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g, (_, mo, d, y) => `d${Number(mo)}/${Number(d)}${year(y)}`);
  take(new RegExp(`\\b${MONTH}\\s+(\\d{4})\\b`, "g"), (_, mo, y) => `m${monthNo(mo)}/${y}`);
  // Full month names on their own ("move-ins in August"). Not "may".
  take(/\b(january|february|march|april|june|july|august|september|october|november|december)\b/g, (mo) => `m${monthNo(mo)}`);
  // Times. A range takes the second time's am/pm when the first has none
  // ("9 to 6pm"), and an earlier-looking start is the morning ("11-2pm").
  const SUFFIX = "(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![a-z])";
  s = s.replace(new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*(?:-|\\u2013|to|until|till|through)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${SUFFIX}`, "g"), (_, h1, m1, h2, m2, suffix) => {
    const second = hour24(h2, suffix);
    let first = hour24(h1, suffix);
    if (first > second) first -= 12;
    tokens.push(`t${first}:${String(Number(m1 ?? 0)).padStart(2, "0")}`, `t${second}:${String(Number(m2 ?? 0)).padStart(2, "0")}`);
    return " ";
  });
  take(new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*${SUFFIX}`, "g"), (_, h, m, suffix) => time(h, m, suffix));
  take(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => time(h, m, null));
  for (const n of s.match(/\d+(?:\.\d+)?/g) ?? []) tokens.push(String(Number(n)));
  return [...new Set(tokens)].sort();
}

// The same as a string, for comparing two sentences at once.
export const numbersOf = (text) => numberTokens(text).join(",");

// True when every amount, time and date in `part` is also in `whole`.
export function numbersWithin(part, whole) {
  const have = new Set(numberTokens(whole));
  return numberTokens(part).every((n) => have.has(n));
}

/*
 * A website saying the same thing in other words: same validity and either
 * the same structured value, or the same amounts and dates in it with only
 * filler words changed. Not a change, so nothing is written and no student
 * gets a correction ("Parking is $75 a month" read again as "Parking costs $75
 * per month"). A changed word that carries meaning is a change even when the
 * numbers stay ("Application fee $50, refundable" read again as "Application
 * fee $50, non-refundable"), PR 447 review.
 */
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const numbersIn = (value, summary) => [...new Set(`${canon(value ?? {})} ${summary ?? ""}`.match(/\d+(?:\.\d+)?/g) ?? [])].sort().join(",");
const plain = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();
// Words that only change how a fact is phrased. Units (month, year, week),
// negations and qualifiers are deliberately not here.
const FILLER = new Set([
  "a", "an", "the", "is", "are", "was", "be", "it", "its", "this", "that", "there",
  "per", "each", "of", "for", "to", "and", "with", "at", "on", "in",
  "cost", "costs", "costing", "charge", "charged", "charges", "fee", "fees",
  "price", "priced", "runs", "comes", "will", "you", "your",
]);
export const meaningWords = (summary) => new Set(plain(summary).split(" ").filter((w) => w && !/\d/.test(w) && !FILLER.has(w)));
export function sameFactReworded(current, { value, summary, validUntil }) {
  if ((current.valid_until ?? null) !== (validUntil ?? null)) return false;
  if (canon(current.value ?? {}) === canon(value ?? {})) return true;
  // The same sentence students see is no change, whatever the structured
  // details say.
  if (plain(current.summary) === plain(summary)) return true;
  const before = numbersIn(current.value, current.summary);
  if (!before || before !== numbersIn(value, summary)) return false;
  const [was, now] = [meaningWords(current.summary), meaningWords(summary)];
  return was.size === now.size && [...was].every((w) => now.has(w));
}

// Words that turn a statement around. A proposal that adds or drops one is a
// change, even with the same numbers ("Dogs and cats welcome, up to 2 pets"
// against "Only cats allowed, up to 2 pets").
const TURNING = /\b(no|not|never|none|only|except|without|cannot|can't|isn't|aren't|won't|prohibited|banned|closed|unavailable|discontinued|ended|longer)\b/g;
export const turningWords = (t) => [...new Set(String(t ?? "").toLowerCase().match(TURNING) ?? [])].sort().join(",");

const hasValue = (v) => !!v && typeof v === "object" && Object.keys(v).length > 0;

/*
 * Whether a proposal changes something a student would act on (PR 478
 * review): a different validity, or a new or different amount, time, date or
 * turning word. Not a change: the same structured value, a reformatted time
 * or date, or a brief mention whose amounts are all in the current fact
 * already ("Pets are welcome with a $300 deposit" against the full pet
 * policy). The keep rules in decideGroup then hold the fuller fact.
 */
export function carriesChange(current, proposal) {
  if ((current.valid_until ?? null) !== (proposal.validUntil ?? null)) return true;
  if (turningWords(proposal.summary) !== turningWords(current.summary)) return true;
  if (hasValue(current.value) && canon(current.value) === canon(proposal.value ?? {})) return false;
  return !numbersWithin(proposal.summary, current.summary);
}

export const saysNothingNew = (current, proposal) => {
  const was = meaningWords(current.summary);
  return [...meaningWords(proposal.summary)].every((w) => was.has(w));
};

const len = (t) => String(t ?? "").length;
export const fullest = (list) => list.reduce((a, b) => (len(b.summary) > len(a.summary) ? b : a));

/*
 * One fact's proposals from a whole-site read, decided once (applyProposals).
 * Returns { keep: true } or { keep: false, best }.
 *
 *   - a proposal that carries a change is written, the fullest of them,
 *     except when the read gives no reason to believe the change (PR 478
 *     review, Grove Lofts' office hours flipping on every read):
 *       . the fact's own page confirmed it in this read (a 'keep' from the
 *         page it is filed under, `keptFrom`) and the change comes from
 *         another page: two pages disagree, and the fact stays with its
 *         own page. A change on the fact's own page is always written, so
 *         a price change on the pricing page still goes through whatever an
 *         old footer says (PR 475 review);
 *       . another page confirmed it and the change only puts back what the
 *         fact said before (`previous`): the same two pages again;
 *   - otherwise, any proposal that only rewords the current fact, or a batch
 *     confirming it is still on its page (`confirmed`), keeps it;
 *   - a fact found under another key (`fromMerge`) is only replaced by a
 *     fuller version;
 *   - a noticeably shorter proposal that says nothing the current fact does
 *     not, or drops some of its amounts, keeps it too: a page saying less;
 *   - otherwise the fullest proposal is written.
 */
export function decideGroup({ current, props, fromMerge = false, confirmed = false, keptFrom = null, previous = null }) {
  let best = fullest(props);
  if (!current) return { keep: false, best };
  let changing = props.filter((p) => carriesChange(current, p));
  if (changing.length && confirmed) {
    const ownPageKept = !!current.source_id && !!keptFrom?.has(current.source_id);
    changing = changing.filter((p) => {
      if (ownPageKept && p.sourceId !== current.source_id) return false;
      if (previous && !carriesChange(previous, p)) return false;
      return true;
    });
    if (!changing.length) return { keep: true };
  }
  if (changing.length) return { keep: false, best: fullest(changing) };
  const keep = confirmed || props.some((p) => sameFactReworded(current, p))
    || (fromMerge && len(best.summary) < len(current.summary))
    // A page saying less: shorter, and nothing new in it, or fewer of the
    // fact's amounts (it carries no change, so its numbers are a subset).
    || (len(best.summary) < len(current.summary) * 0.8 && (saysNothingNew(current, best) || numbersOf(best.summary) !== numbersOf(current.summary)));
  return keep ? { keep: true } : { keep: false, best };
}

/*
 * The duplicate check's verdicts applied to a read's groups of proposals
 * (applyProposals). `groups` maps a group id to { section, key, scopeLevel,
 * scopeId, current, props } and is changed in place; `fresh` is the
 * [id, group] pairs under keys the listing does not have yet, in the order
 * the model saw them; `verdicts[i]` is findDuplicates' answer for fresh[i].
 * Returns { merged, touched }: how many groups were folded into another,
 * and the ids of existing facts a duplicate confirmed.
 *
 *   - a verdict is only acted on when no number is lost (PR 478 review, the
 *     same rule as tidyDuplicates): a duplicate must say no amount, time or
 *     date its target does not, and an update must keep every one its target
 *     has. Otherwise the new fact stays a fact of its own ("Garage parking
 *     is $100" is not a duplicate of "Surface lot parking is $50");
 *   - a new fact matched to an earlier new fact that was itself already
 *     folded into an existing fact (or dropped as its duplicate) follows it
 *     there, instead of being written under a key of its own.
 */
export function mergeDuplicateGroups({ groups, fresh, verdicts, factIdOf }) {
  let merged = 0;
  const touched = [];
  // Where each folded new group went: { group: id } or { fact }.
  const went = new Map();
  const shown = fresh.map(([, g]) => (g.props.length ? fullest(g.props).summary : ""));
  const keepsNumbers = (verdict, mine, ref) => (verdict === "duplicate" ? numbersWithin(mine, ref) : numbersWithin(ref, mine));
  fresh.forEach(([id, g], i) => {
    const v = verdicts[i];
    if (!v || v.verdict === "new" || !g.props.length) return;
    const mine = fullest(g.props).summary;
    let fact = null;
    let groupId = null;
    if (v.target?.kind === "fact") {
      fact = v.target.fact;
    } else if (v.target?.kind === "new") {
      const [tid] = fresh[v.target.index] ?? [];
      if (!tid || tid === id) return;
      if (!keepsNumbers(v.verdict, mine, shown[v.target.index])) return;
      const there = went.get(tid);
      if (there?.fact) fact = there.fact;
      else groupId = there?.group ?? tid;
    } else {
      return;
    }
    if (fact) {
      if (!keepsNumbers(v.verdict, mine, fact.summary)) return;
      const tid = factIdOf(fact);
      groups.delete(id);
      merged++;
      if (v.verdict === "duplicate") {
        went.set(id, { fact });
        if (!groups.has(tid)) touched.push(fact.id);
        return;
      }
      if (!groups.has(tid)) groups.set(tid, { section: fact.section, key: fact.field_key, scopeLevel: fact.scope_level, scopeId: fact.scope_id, current: fact, props: [] });
      groups.get(tid).props.push(...g.props);
      groups.get(tid).fromMerge = true;
      went.set(id, { group: tid });
      return;
    }
    const tg = groups.get(groupId);
    if (!tg || groupId === id) return;
    // Through an earlier new fact onto an existing one: an update must also
    // keep every number of the existing fact.
    if (tg.current && v.verdict === "update" && !numbersWithin(tg.current.summary, mine)) return;
    groups.delete(id);
    merged++;
    tg.props.push(...g.props);
    if (tg.current) tg.fromMerge = true;
    went.set(id, { group: groupId });
  });
  return { merged, touched };
}
