-- Product Tutor loop memory: one row per standout finding per tutor run.
-- Apply to BOTH dev and prod (see .claude/rules/api.md).
-- `date` is run_started_at (UTC), shared by all findings of one run; `rank` is
-- the finding's leverage rank within that run. (date, rank) is the retry-safe
-- upsert key: a re-run of the same tutor invocation must UPSERT, never duplicate.
create table if not exists public.product_lessons (
  date            timestamptz not null,
  rank            smallint not null default 1,
  evidence        text not null,
  lesson          text not null,
  change          text not null,
  -- name | PostHog query | baseline window | target | evaluation window | minimum sample | result
  success_metric  text not null,
  -- proposed | accepted | modified | rejected | shipped | evaluated
  status          text not null default 'proposed'
                  check (status in ('proposed','accepted','modified','rejected','shipped','evaluated')),
  decision_notes  text,
  primary key (date, rank)
);

comment on table public.product_lessons is
  'Product Tutor loop memory. Written only by the proximity-tutor skill; changes are never auto-shipped.';

-- RLS on with no policies: the app's anon/auth clients can never touch this
-- table; only service-role access (the tutor via MCP) bypasses RLS.
alter table public.product_lessons enable row level security;
