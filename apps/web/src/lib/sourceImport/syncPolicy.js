/*
 * What the daily website sync does with each change it finds.
 *
 * There is no review queue (Wyatt, 2026-11-11): nobody can work through a
 * pile of proposed changes every day, so every change a sync finds is either
 * applied or denied on the spot, by its kind and by how sure the read is of
 * that one fact. The landlord's own data always wins. Imports, and the
 * "proposed changes" a landlord reviews after adding a website, still queue;
 * this is only the recurring sync.
 *
 *   applied   lease withdrawn (the site no longer offers it), new unit, new
 *             lease, photos, a unit's blanks filled (floor plan drawing, size)
 *   denied    a disagreement with the landlord's specs (beds, baths, size,
 *             name), property prose and specials, anything the landlord set
 *   depends   a rent change applies when the price is the price, not a
 *             "starting at"; a withdrawal applies when the read saw the
 *             site's whole list of units, so a unit it never reached is not
 *             taken as let
 *
 * Pure: decides from the change and the snapshot, writes nothing.
 */

export const DENY = {
  landlord: "set by the landlord, who wins",
  specs: "the landlord's unit details win over the website's",
  property: "the landlord's description and specials win over the website's",
  partialRead: "the read did not see the website's whole list of units, so nothing it missed is taken as let",
  roughPrice: "the website shows a starting-at price, not this lease's price",
  roughWithdraw: "the website shows no exact price for this plan, so it cannot say this lease's price is gone",
  takenDown: "the landlord took this lease down, so the website does not put it back",
  noLettings: "the read showed no units or no prices, so it says nothing about what is let",
  notFromSite: "not on the website, left as is: the website has never shown this unit",
  churn: "too much changed at once, so the whole run was skipped",
  unknown: "not a change the sync makes on its own",
};

/*
 * One change. Returns { apply, reason }; reason is set when denied, or when a
 * change applies in a reduced form (a new unit added as a draft).
 *   snapshot   the read: unitListComplete, portal
 */
export function decideSyncChange(c, { snapshot }) {
  const d = c.detail ?? {};
  // Holds set while planning, each with its own reason in the note.
  if (c.protected) return { apply: false, reason: DENY.landlord };
  if (c.elsewhere) return { apply: false, reason: c.note ?? DENY.unknown };
  if (c.gated && c.kind !== "unit_new") return { apply: false, reason: c.note ?? "the landlord cannot publish yet" };
  // A unit's own page speaks for that unit alone and is always taken.
  const fromUnitPage = !!d.fromUnitPage;

  switch (c.kind) {
    case "photos_added":
    case "unit_updated":
    case "lease_new":
      return { apply: true, reason: null };
    case "unit_new":
      return { apply: true, reason: d.draft ? c.note ?? "added as a draft" : null };
    case "lease_updated":
      // Gaps were already left out while planning: only stated facts are here.
      return { apply: true, reason: null };
    case "rent_change": {
      const f = c.facts ?? {};
      if (f.fromModel && f.rentExact === false && !fromUnitPage) return { apply: false, reason: DENY.roughPrice };
      return { apply: true, reason: null };
    }
    case "lease_withdrawn": {
      if (c.lookalike) return { apply: false, reason: c.note ?? DENY.unknown };
      if (fromUnitPage || d.unitPageGone) return { apply: true, reason: null };
      if (!snapshot?.unitListComplete) return { apply: false, reason: DENY.partialRead };
      // One price gone from a plan the site still lists: only when the page
      // states that plan's prices exactly (read by a feed, or exact on the page).
      const f = c.facts ?? {};
      if (!d.unitGone && f.fromModel && (f.noPrice || f.rentsExact === false)) return { apply: false, reason: DENY.roughWithdraw };
      return { apply: true, reason: null };
    }
    case "unit_relisted":
      // Back on the site: routine when it was a sync that took it down.
      return c.auto ? { apply: true, reason: null } : { apply: false, reason: DENY.takenDown };
    case "spec_mismatch":
      return { apply: false, reason: DENY.specs };
    case "property_updated":
      return { apply: false, reason: DENY.property };
    case "missing_unit":
      return { apply: false, reason: c.notFromSite || d.notFromSite ? DENY.notFromSite : DENY.noLettings };
    default:
      return { apply: false, reason: DENY.unknown };
  }
}

const CHURN_FRACTION = 0.2;
const CHURN_MIN_LEASES = 5;
const MAX_NEW_UNITS = 4;

/*
 * The churn guard. More than a fifth of the listing's leases changing at once
 * is more likely a misread than a building re-let overnight, so the run is
 * skipped and the team is told. Returns { touched, existing, newUnits, units }
 * when the run should be skipped, else null.
 *
 *   policyRun     count only what the policy would apply (a denied change is no churn)
 *   portalPriced  a leasing portal read in full (readers/portalWalk.js): its
 *                 weekly repricing is the landlord's own price list, not churn
 *
 * Churn is leases appearing, vanishing or repricing. A lease whose blurb or
 * lengths were reworded is the same lease (every lease gaining the words
 * "Available now" once held a building). A unit's own page speaks for that
 * unit alone. A new unit going live counts each lease it brings, and new
 * units have a cap of their own whatever the listing's size (PR #418 review:
 * the 11/4 Coronado Place sync added every floor plan of Lindell Tower East,
 * another building on the same website). A unit added as a draft changes
 * nothing students see and is no churn (The Shelby's twelve waitlisted plans
 * would otherwise skip every run after).
 */
export function churnCheck({ changes, existingLeases, existingUnits, policyRun = true, portalPriced = false }) {
  const counted = changes.filter((c) => !c.detail?.fromUnitPage && (!policyRun || c.verdict?.apply));
  const goesLive = (c) => c.kind === "unit_new" && !c.detail?.draft;
  const touched = portalPriced
    ? 0
    : counted.reduce((n, c) => {
        if (goesLive(c)) return n + Math.max(1, (c.detail?.offers ?? []).length);
        if (["lease_new", "lease_withdrawn", "unit_relisted", "rent_change"].includes(c.kind)) return n + 1;
        if (c.kind === "lease_updated" && /\b(rent|available_from|unavailable)\b/.test(c.field ?? "")) return n + 1;
        return n;
      }, 0);
  const newUnits = counted.filter(goesLive).length;
  const tooManyUnits = newUnits > MAX_NEW_UNITS || (existingUnits >= 1 && newUnits > existingUnits);
  const tooMuchChurn = existingLeases >= CHURN_MIN_LEASES && touched > Math.ceil(existingLeases * CHURN_FRACTION);
  return tooManyUnits || tooMuchChurn ? { touched, existing: existingLeases, newUnits, units: existingUnits } : null;
}
