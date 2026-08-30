-- Carry the property's move-in date down onto the offerings that have none.
--
-- Availability moved from the property to the offering: a unit is let by a
-- particular landlord from a particular date, and two landlords competing on the
-- same unit can be free at different times. unit_leases.available_from is where
-- that now lives, and browse already filters on it.
--
-- Except almost nothing populates it — 9 of 203 live offerings carry a date —
-- so the move-in filter currently excludes almost nobody and is close to inert.
-- Meanwhile 40 listings still hold a perfectly good date on the old
-- listings.move_in_date column, which nothing reads for filtering any more.
--
-- This moves that information where it is now used: 66 offerings across 32
-- properties gain a date. It is the step that makes retiring the property-level
-- column safe, rather than throwing the dates away with it.
--
-- Only offerings that are LIVE and have no date of their own are touched, so a
-- landlord's own entry is never overwritten and a withdrawn offering is left
-- alone. Re-running is a no-op: once a lease has a date it no longer qualifies.
--
-- The date is cast defensively. listings.move_in_date is TEXT, not a date, so a
-- row could hold anything; only strict ISO YYYY-MM-DD values are used and the
-- rest are skipped rather than failing the migration.
--
-- Note this does not fire unit_leases_sublease_guard: that trigger watches
-- unit_id, sublease, is_active and unavailable, none of which change here.

UPDATE unit_leases ul
SET available_from = nullif(btrim(l.move_in_date), '')::date
FROM listing_units u
JOIN listings l ON l.id = u.listing_id
WHERE ul.unit_id = u.id
  AND u.deleted_at IS NULL
  AND l.deleted_at IS NULL
  AND ul.is_active
  AND NOT COALESCE(ul.unavailable, false)
  AND ul.available_from IS NULL
  AND l.move_in_date ~ '^\s*\d{4}-\d{2}-\d{2}\s*$';
