-- Shadow scores (sync confidence ledger, stage 1). Every change a daily sync
-- plans, scored the ledger's way (lib/sourceImport/score.js) next to what
-- today's rules did with it. Read by the admin borderline list and the
-- accuracy-by-platform report; nothing here changes a listing. Server only.
-- Apply to dev and prod.
create table if not exists public.listing_sync_scores (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  run_at timestamptz not null default now(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  monitor_id uuid references public.listing_source_monitors(id) on delete set null,
  change_key text not null,
  kind text not null,
  unit_key text,
  unit_id uuid,
  lease_id uuid,
  field text,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  source text not null,
  platform text not null,
  trust numeric not null,
  read_quality numeric not null,
  right_thing numeric not null,
  freshness numeric not null,
  score numeric not null,
  current_score numeric not null,
  need numeric not null,
  bar numeric not null,
  reads_in_row integer not null default 1,
  ledger_apply boolean not null,
  ledger_hidden boolean not null default false,
  ledger_reason text,
  borderline boolean not null default false,
  policy_apply boolean not null,
  policy_reason text,
  landlord_edited boolean not null default false,
  jev jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_listing_sync_scores_listing_run on public.listing_sync_scores (listing_id, run_at desc);
create index if not exists idx_listing_sync_scores_run_at on public.listing_sync_scores (run_at desc);
create index if not exists idx_listing_sync_scores_borderline on public.listing_sync_scores (run_at desc) where borderline;

alter table public.listing_sync_scores enable row level security;
revoke all on public.listing_sync_scores from anon, authenticated;
