/*
 * student_roster_invite_status: the roster with "have we already asked them?" attached.
 *
 * The admin bulk-send screen has to answer two questions over 6,595 rows, with
 * search and paging, on every keystroke: who has a first name (the message
 * template interpolates one), and who has already been invited (so nobody is
 * asked twice). Both are joins, and doing them in the application would mean
 * pulling the whole roster and the whole invite ledger into memory per request.
 *
 * Derived, NOT a "sent" column written onto student_roster. The ledger is
 * already the record of what was sent, and a duplicated flag is a second source
 * of truth that a roster re-import would silently reset: the students most
 * likely to be re-imported are exactly the ones we already emailed. A view
 * cannot drift from the thing it reads.
 *
 * SECURITY_INVOKER IS LOAD-BEARING. A Postgres view runs with its owner's
 * rights by default, which would make this an open door around the RLS on
 * student_roster and publish 6,595 students' names and addresses to anyone
 * holding the anon key. With security_invoker the caller's own permissions
 * apply, so the base tables' RLS (enabled, no policies) still means
 * service-role only. The revokes below are the second lock on the same door.
 */
create or replace view public.student_roster_invite_status
with (security_invoker = true) as
select
  r.id,
  r.email,
  r.first_name,
  r.last_name,
  r.class_year,
  /*
   * A blank string is as unusable as NULL when the template says
   * "Hi {first_name}", so both collapse to one flag the UI can filter on
   * rather than making every caller remember to check for both.
   */
  (coalesce(btrim(r.first_name), '') <> '') as has_first_name,
  i.id is not null                          as invited,
  i.sent_at                                 as last_invited_at,
  i.used_at                                 as review_written_at,
  i.expires_at                              as invite_expires_at
from public.student_roster r
/*
 * The most recent invite only. Someone can be invited more than once (a
 * reminder, a resend after a bounce), and for "should we email this person
 * today?" the latest attempt is the one that answers it.
 */
left join lateral (
  select v.id, v.sent_at, v.used_at, v.expires_at
  from public.review_invites v
  where lower(v.invited_email) = lower(r.email)
  order by v.created_at desc
  limit 1
) i on true;

revoke all on public.student_roster_invite_status from anon, authenticated;
