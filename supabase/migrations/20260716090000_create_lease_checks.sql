create table if not exists lease_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  file_name text,
  file_type text,
  page_count int,
  matched_listing_id uuid references listings(id) on delete set null,
  match_confidence text not null default 'none',  -- 'high' | 'low' | 'none'
  flags jsonb not null default '[]'::jsonb,
  summary text,
  unreadable_pages int[] default '{}',
  model text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_lease_checks_user
  on lease_checks (user_id, created_at desc)
  where deleted_at is null;
