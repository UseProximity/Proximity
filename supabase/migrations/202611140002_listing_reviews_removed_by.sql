-- Who took a listing review down (Wyatt, 2026-11-14). deleted_at alone cannot
-- tell an admin removal from an author withdrawing their own review or a
-- landlord dismissing one awaiting approval, and action_log stamps all three
-- as the system. The admin Reviews page offers one-click Restore only for
-- reviews an admin removed.
--
--   admin     removed from the admin dashboard
--   author    the reviewer deleted it themselves
--   landlord  the listing's landlord dismissed it while it awaited approval
--   NULL      live, or removed before this column existed
--
-- Additive and nullable: no existing row changes.

ALTER TABLE public.listing_reviews ADD COLUMN IF NOT EXISTS removed_by text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listing_reviews_removed_by_check') THEN
    ALTER TABLE public.listing_reviews
      ADD CONSTRAINT listing_reviews_removed_by_check CHECK (removed_by IN ('admin', 'author', 'landlord'));
  END IF;
END $$;
