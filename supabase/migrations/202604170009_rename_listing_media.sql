-- Ensures listing_images exists, migrates legacy layouts into it.
--
-- Two environments in the wild:
--   (a) Had a `listing_media` table (some dev branches) → rename to `listing_images`.
--   (b) Stored images in `listings.images text[]` (prod) → create fresh + backfill from array.
-- Both produce the same end state: a `listing_images(listing_id, url, sort_order, alt_text, …)` table.

-- 1. Rename listing_media → listing_images if that's how this env stored media.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listing_media'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listing_images'
  ) THEN
    ALTER TABLE listing_media RENAME TO listing_images;
  END IF;
END $$;

-- 2. Create listing_images from scratch if neither existed.
CREATE TABLE IF NOT EXISTS listing_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url         text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  alt_text    text,
  media_type  text NOT NULL DEFAULT 'image',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. Rename legacy column names if a pre-v4 listing_media brought them along.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_images' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE listing_images RENAME COLUMN display_order TO sort_order;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_images' AND column_name = 'caption'
  ) THEN
    ALTER TABLE listing_images RENAME COLUMN caption TO alt_text;
  END IF;
END $$;

-- 4. Backfill any columns the rename path might have missed.
ALTER TABLE listing_images
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS alt_text   text,
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 5. Ensure the FK exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'listing_images' AND constraint_name = 'listing_images_listing_id_fkey'
  ) THEN
    ALTER TABLE listing_images
      ADD CONSTRAINT listing_images_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listing_images_listing ON listing_images (listing_id, sort_order);

-- 6. Backfill from legacy `listings.images text[]` if that column is still present
--    and any rows aren't already in listing_images. Skips empty / duplicate URLs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'listings' AND column_name = 'images'
  ) THEN
    INSERT INTO listing_images (listing_id, url, sort_order)
    SELECT l.id, img.url, img.ord - 1
    FROM listings l,
         LATERAL unnest(l.images) WITH ORDINALITY AS img(url, ord)
    WHERE l.images IS NOT NULL
      AND array_length(l.images, 1) > 0
      AND img.url IS NOT NULL
      AND img.url <> ''
      AND NOT EXISTS (
        SELECT 1 FROM listing_images li
        WHERE li.listing_id = l.id AND li.url = img.url
      );
  END IF;
END $$;

DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_images;
  RAISE NOTICE 'Migration 0009: listing_images present with % rows.', v_count;
END $$;
