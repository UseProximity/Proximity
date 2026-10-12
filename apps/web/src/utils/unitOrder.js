/*
 * The order units appear in, everywhere: the landlord's own order first
 * (listing_units.sort_order, set by dragging the unit tabs), then beds and
 * baths for any unit that has never been placed.
 *
 * Accepts the shaped unit (sortOrder) and the raw row (sort_order), so loaders,
 * the admin view and the lookup route can all share it.
 */
const orderOf = (u) => u?.sortOrder ?? u?.sort_order ?? null;

export function compareUnits(a, b) {
  const oa = orderOf(a);
  const ob = orderOf(b);
  if (oa != null || ob != null) {
    if (oa == null) return 1;
    if (ob == null) return -1;
    if (oa !== ob) return oa - ob;
  }
  const beds = (a?.bedrooms ?? 0) - (b?.bedrooms ?? 0);
  if (beds !== 0) return beds;
  return (a?.bathrooms ?? 0) - (b?.bathrooms ?? 0);
}

export const sortUnits = (units) => [...(units ?? [])].sort(compareUnits);
