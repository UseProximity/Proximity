-- Sign in with Apple: the refresh token returned when the sign-in authorization
-- code is exchanged. Its only purpose is to let account deletion revoke the
-- user's Apple grant (App Store requirement for apps that create accounts with
-- Sign in with Apple). Server-side only: it is useless without our Apple signing
-- key, and it must never be added to dashboardUser.js's USER_PUBLIC_COLUMNS.
-- Cleared as soon as it has been revoked, and again when the account is purged.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS apple_refresh_token text;
