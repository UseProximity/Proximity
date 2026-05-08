/**
 * Returns all active leases in the same unit_group_label as signedLease that
 * are logically incompatible (different bedrooms, or same physical unit / same group).
 * The landlord confirms before we disable anything.
 */
export function findConflictingLeases(allLeases, signedLease) {
  if (!signedLease.unit_group_label) return [];
  return allLeases.filter(
    (l) =>
      l.id !== signedLease.id &&
      l.unit_group_label === signedLease.unit_group_label &&
      l.is_active &&
      !l.deleted_at
  );
}

/** Group leases by unit_group_label (or each un-labelled lease is its own group). */
export function groupLeasesByUnit(leases) {
  const groups = {};
  for (const lease of leases) {
    const key = lease.unit_group_label ?? `_ungrouped_${lease.id}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(lease);
  }
  return groups;
}
