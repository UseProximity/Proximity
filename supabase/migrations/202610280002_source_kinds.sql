-- Two new kinds of knowledge source (Wyatt, 2026-10-27, round 6):
--   description   the listing's own description and lease notes, read into
--                 knowledge and never removed by a later change to the text
--   landlord_edit a fact the landlord edited in the Agent tab
--                 ("Updated by you on Oct 28")

alter table public.listing_sources drop constraint if exists listing_sources_kind_check;
alter table public.listing_sources add constraint listing_sources_kind_check check (kind in (
  'site_data', 'page', 'document', 'landlord_statement', 'landlord_answer',
  'pms', 'admin', 'chat_backfill', 'description', 'landlord_edit'
));

-- A landlord's edit or delete of one fact from the Agent tab is its own cause.
alter table public.listing_fact_events drop constraint if exists listing_fact_events_cause_check;
alter table public.listing_fact_events add constraint listing_fact_events_cause_check check (cause in (
  'seed', 'sync', 'url_added', 'landlord_chat', 'landlord_answer',
  'dashboard', 'admin', 'document', 'backfill', 'revert', 'landlord_edit'
));
