-- Where a listing's numbers live on its landlord's leasing portal
-- (SecureCafe property, floor plan and apartment ids), learned on the first
-- read so the weekly sync re-renders only what changed. Apply to dev and prod.
alter table public.listing_source_monitors
  add column if not exists portal jsonb;
comment on column public.listing_source_monitors.portal is
  'Portal coordinates learned by lib/sourceImport/readers/securecafe.js: { kind, host, slug, propertyId, term, range, plans[], apartments[] }.';
