/*
 * The account columns behind a student's saved sizes and lease lengths.
 *
 * Several of each can be picked at once (Wyatt, 2026-11-01), so they are saved
 * as lists in users.preferred_beds_list and users.preferred_lease_months_list
 * (migration 202611010001). The single columns from before keep the first pick,
 * so anything still reading them sees a sensible value.
 */
import { normalizeBedsList, normalizeMonthsList } from "./leaseFit.js";

const LIST_COLUMNS = ["preferred_beds_list", "preferred_lease_months_list"];

// The saved list, falling back to the single value saved before lists existed.
export function savedList(list, single) {
  if (Array.isArray(list) && list.length) return list;
  return single == null ? [] : [single];
}

// The columns to write for `beds` and `months` (each a list, a number or null).
export function prefColumns({ beds, months } = {}) {
  const out = {};
  if (beds !== undefined) {
    const list = normalizeBedsList(beds);
    out.preferred_beds_list = list;
    out.preferred_beds = list[0] ?? null;
  }
  if (months !== undefined) {
    const list = normalizeMonthsList(months);
    out.preferred_lease_months_list = list;
    out.preferred_lease_months = list[0] ?? null;
  }
  return out;
}

// `fields` without the list columns, for a database the migration hasn't reached.
export const withoutListColumns = (fields) =>
  Object.fromEntries(Object.entries(fields).filter(([k]) => !LIST_COLUMNS.includes(k)));

export const touchesListColumns = (fields) => LIST_COLUMNS.some((k) => k in fields);
