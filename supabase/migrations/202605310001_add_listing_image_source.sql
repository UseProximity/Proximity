-- Tag the origin of each listing image so the UI can show a "Street View" badge
-- and the add-listing / referral-review flows can mark auto-fetched photos.
-- null = user upload; 'street_view' = auto-fetched from Google Street View.
alter table public.listing_images
  add column if not exists source text;

comment on column public.listing_images.source is 'Origin of the image. null = user upload; ''street_view'' = auto-fetched from Google Street View.';
