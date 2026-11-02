-- One open (proposed) change per monitor, kind, unit and field was too
-- narrow: a floor plan with two new prices is two lease_new changes with the
-- same kind, unit and field, so the second broke the insert and every
-- proposed change of that read was lost (212 Clayton: 19 changes, none
-- saved). The new value now tells changes apart; the same change proposed
-- again on a later run is still one open event. Apply to dev and prod.
drop index if exists public.uq_listing_source_events_open;
create unique index uq_listing_source_events_open
  on public.listing_source_events (monitor_id, kind, coalesce(unit_key, ''), coalesce(field, ''), md5(coalesce(new_value::text, '')))
  where status = 'open';
