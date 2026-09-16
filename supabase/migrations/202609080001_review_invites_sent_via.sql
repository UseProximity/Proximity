/*
 * review_invites.sent_via — how the link reached the student.
 *
 * Invites can now leave this system two ways. The dashboard mails them itself
 * ('app'), or an admin exports a batch of links as a CSV and sends them from
 * their own mailbox ('export'), which is how outreach goes out under a personal
 * wustl.edu address instead of info@useproximity.org.
 *
 * The column exists because sent_at alone becomes a lie in the export case.
 * Handing the links to a mail merge IS the send as far as this app can tell:
 * it will never see an SMTP result, so it stamps sent_at at export time and has
 * no way to distinguish that from an email it actually delivered. Without this
 * column the ledger claims we mailed people we merely handed to someone else,
 * and a bounce investigation starts by looking in the wrong outbox.
 *
 * Defaulting to 'app' is correct for the existing rows: everything minted
 * before this migration went out through sendReviewInviteEmail.
 */
alter table public.review_invites
  add column if not exists sent_via text not null default 'app';

alter table public.review_invites
  drop constraint if exists review_invites_sent_via_check;

alter table public.review_invites
  add constraint review_invites_sent_via_check
  check (sent_via in ('app', 'export'));
