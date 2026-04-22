-- listing_landlords has no id column; the fn_action_log trigger reads NEW.id::uuid
-- which returns NULL and violates action_log.record_id NOT NULL.
-- Add a surrogate id so the trigger can log changes to this table.

ALTER TABLE listing_landlords
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE listing_landlords
  DROP CONSTRAINT IF EXISTS listing_landlords_pkey;

ALTER TABLE listing_landlords
  ADD PRIMARY KEY (id);

ALTER TABLE listing_landlords
  ADD CONSTRAINT listing_landlords_listing_user_unique UNIQUE (listing_id, user_id);

DO $$ BEGIN RAISE NOTICE 'Migration 202604220001: added id PK to listing_landlords.'; END $$;
