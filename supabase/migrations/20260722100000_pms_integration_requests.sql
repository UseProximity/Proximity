-- Landlord-submitted requests for PMS integrations we don't support yet.
-- Fed by the "Don't see your property management system?" card in the
-- dashboard's PMS Sync section. Used to prioritize connector work (and as
-- leverage when negotiating vendor API access). One row per landlord per
-- system name (case-insensitive).

create table if not exists pms_integration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider_name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_pms_integration_requests_user_provider
  on pms_integration_requests (user_id, lower(provider_name));
