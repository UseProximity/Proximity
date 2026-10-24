-- Close the users INSERT hole for direct PostgREST callers.
--
-- users_insert (202604170027) passed whenever app.current_user_id was unset,
-- which is ALWAYS the case for a request made with the anon or authenticated
-- key, because only the server RPCs set that setting. Its WITH CHECK placed no
-- limit on role_id, password_hash or email_verified, so anyone holding the
-- anon key (it ships in the browser bundle) could insert a verified super
-- account and sign in with it.
--
-- Every legitimate write to users goes through the service role, which
-- bypasses RLS, so neither the NULL-identity escape nor the table grants are
-- needed by the app. Both are removed: the policy stops passing on a missing
-- identity, and anon/authenticated lose INSERT/UPDATE/DELETE on users outright
-- (belt and braces, in case a later policy is written loosely again).

DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (fn_current_user_role() IN ('super', 'system'));

REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;
