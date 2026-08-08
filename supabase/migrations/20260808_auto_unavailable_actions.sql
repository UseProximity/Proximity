-- Auto-unavailable: audit/queue table for automated hides driven by landlord
-- "leased" reports from the email check-in system (proximity-automation repo).
-- Every hide is recorded here with before/after state, a post-write verification
-- outcome against the public listings API, and undo tracking for Ben's daily
-- review email.
--
-- HARD GUARANTEES of the feature this table serves:
--   * It NEVER deletes a listing. The only writes are reversible availability
--     flips (listings.unavailable / listing_units.available) through the
--     audited rpc_pms_apply function.
--   * It NEVER writes the check-in system's columns (checkin_*, last_verified_*,
--     unit_type_status, leased_elsewhere_detail, pending_owner_review, ...).
--     Those are read-only detection signal.
--   * It never touches rows with deleted_at set, or TEST-titled rows.

create table if not exists auto_unavailable_actions (
  id                   uuid primary key default gen_random_uuid(),
  listing_id           uuid not null references listings(id) on delete cascade,

  -- What the landlord reported, captured at detection time.
  reported_choice      text not null,   -- checkin_response_choice, or 'unit_type_status' for per-bedroom reports
  reported_detail      text,            -- leased_elsewhere_detail, if any
  reported_at          timestamptz,     -- listings.last_verified_at at detection: the report's fingerprint

  -- What was hidden: {"listing": true} or {"units": [{"id": ..., "bedrooms": ...}, ...]}
  scope                jsonb not null,

  status               text not null check (status in ('applied', 'failed', 'undone')),
  before_state         jsonb,
  after_state          jsonb,

  -- Post-write verification against the public listings API.
  verify_result        text,
  verified_at          timestamptz,

  applied_at           timestamptz not null default now(),
  digest_sent_at       timestamptz,     -- when this hide appeared in Ben's review email
  correction_noted_at  timestamptz,     -- when a landlord's leased->available correction was surfaced

  undone_at            timestamptz,
  undo_verify_result   text,
  undo_digest_sent_at  timestamptz,

  created_at           timestamptz not null default now()
);

-- Each landlord report is actioned at most once: if Ben undoes a hide, the same
-- report can never re-hide the listing. Only a NEW report (fresh
-- last_verified_at) can trigger a new action.
create unique index if not exists uq_auto_unavailable_fingerprint
  on auto_unavailable_actions (listing_id, coalesce(reported_at, 'epoch'::timestamptz));

create index if not exists idx_auto_unavailable_status
  on auto_unavailable_actions (status, applied_at desc);

-- Service-role access only (the app's server-side client bypasses RLS).
alter table auto_unavailable_actions enable row level security;
