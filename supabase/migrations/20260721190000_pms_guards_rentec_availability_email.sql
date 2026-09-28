-- PMS coverage v2 (P1–P3) schema guards.
--
-- 1) Scrape connections are signal-only by DB constraint: even if application
--    code regresses, a scrape connection can never be set to auto-apply.
-- 2) Rentec Direct joins the allowed providers (self-serve free API, P2).
-- 3) listings.availability_email_sent_at — bookkeeping for the one-click
--    "still available?" landlord email (P3), so a landlord is never re-asked
--    about the same listing more than once per cool-down window.

alter table pms_connections
  drop constraint if exists chk_pms_scrape_never_auto_apply;
alter table pms_connections
  add constraint chk_pms_scrape_never_auto_apply
  check (provider <> 'scrape' or auto_apply = false);

alter table pms_connections
  drop constraint if exists pms_connections_provider_check;
alter table pms_connections
  add constraint pms_connections_provider_check
  check (provider in
    ('buildium','appfolio','doorloop','rentec','rentmanager','resman','scrape','aggregator'));

alter table listings
  add column if not exists availability_email_sent_at timestamptz;
