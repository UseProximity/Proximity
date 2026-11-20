/*
 * Whether a property is complete enough to go live: some unit still standing
 * carries an offering with a rent. Shared by publishing (publish.js) and the
 * paper agreement's "Publish now?" list (lib/billing/paperAgreements.js), so the
 * two never disagree. No imports, so node --test can load it.
 */
export const liveRows = (rows) => (rows ?? []).filter((r) => !r.deleted_at);

export function hasPricedLease(units) {
  return liveRows(units).some((u) => liveRows(u.unit_leases).some((l) => Number(l.rent) > 0));
}
