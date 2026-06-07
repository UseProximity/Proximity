-- Let a reviewer post anonymously: their user_id stays attached to the row (for
-- moderation/attribution), but the public listing + landlord views display the
-- author as "Anonymous" instead of their name/avatar.
-- Set via the /refer/<id> review flow's "Post anonymously" toggle.
alter table public.listing_reviews
  add column if not exists anonymous boolean not null default false;

comment on column public.listing_reviews.anonymous is 'When true, hide the author identity in public/landlord review displays (user_id is still stored for moderation).';
