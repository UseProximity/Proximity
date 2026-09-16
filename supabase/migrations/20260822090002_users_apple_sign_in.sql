-- Sign in with Apple: apple_sub is Apple's stable per-app user identifier
-- (the `sub` claim in the identity token). It must be the lookup key instead
-- of email, since Apple only returns email on the first authorization and
-- may omit it on repeat sign-ins. apple_account mirrors google_account.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS apple_sub text,
  ADD COLUMN IF NOT EXISTS apple_account boolean DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS users_apple_sub_key
  ON public.users (apple_sub)
  WHERE apple_sub IS NOT NULL;
