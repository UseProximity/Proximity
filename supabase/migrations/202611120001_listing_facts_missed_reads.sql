-- Weekly knowledge read (2026-11-12): how many weekly reads in a row a fact's
-- page was re-read and did not say it. At 2 the fact is taken out
-- (lib/agents/pages.js noteMissingFacts). A fact the page says again, or
-- whose page is unchanged, goes back to 0. A new version of a fact starts at 0.
alter table public.listing_facts
  add column if not exists missed_reads smallint not null default 0;
