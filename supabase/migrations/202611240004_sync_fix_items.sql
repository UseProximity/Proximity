-- Fix items from the rare Claude checker (sync confidence ledger, stage 3).
-- When a change keeps missing its bar by a little, Claude is asked once to
-- settle it, and its answer opens an item here saying what code should have
-- caught, so the case is fixed in code and Claude is not needed for it again
-- (Wyatt, 2026-11-22). Server only. Apply to dev and prod.
create table if not exists public.sync_fix_items (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  change_key text not null,
  kind text not null,
  change jsonb not null,
  evidence text,
  score numeric,
  need numeric,
  verdict text not null check (verdict in ('apply', 'leave')),
  reason text,
  suggested_fix text,
  model text,
  cost_usd numeric,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists uq_sync_fix_items_change on public.sync_fix_items (listing_id, change_key);
create index if not exists idx_sync_fix_items_open on public.sync_fix_items (created_at desc) where status = 'open';

alter table public.sync_fix_items enable row level security;
revoke all on public.sync_fix_items from anon, authenticated;
