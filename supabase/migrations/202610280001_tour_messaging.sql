-- Tours (Wyatt, 2026-10-27, round 6): a landlord who cannot make the
-- student's times no longer proposes slots; they message the student
-- directly. The request moves to 'messaging' and stays open (one open
-- request per student per lease) until it is confirmed or cancelled.

alter table public.tour_requests drop constraint if exists tour_requests_status_check;
alter table public.tour_requests add constraint tour_requests_status_check
  check (status = any (array['requested', 'proposed', 'messaging', 'confirmed', 'cancelled', 'expired']));

drop index if exists public.tour_requests_open_uq;
create unique index tour_requests_open_uq on public.tour_requests (student_id, coalesce(lease_id, listing_id))
  where status = any (array['requested', 'proposed', 'messaging']);

drop index if exists public.tour_requests_landlord_open_idx;
create index tour_requests_landlord_open_idx on public.tour_requests (landlord_id, created_at desc)
  where status = any (array['requested', 'proposed', 'messaging']);
