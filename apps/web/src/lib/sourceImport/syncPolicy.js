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
  takenDown: "the landlord took this lease down, so the website does not put it back",
  noLettings: "the read showed no units or no prices, so it says nothing about what is let",
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
      return { apply: false, reason: DENY.noLettings };
    default:
      return { apply: false, reason: DENY.unknown };
  }
}
