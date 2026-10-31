/*
 * A signed-out visitor's email, given in the chat (Wyatt, 2026-10-27).
 *
 * When Proxy sends a question to the landlord it asks the visitor, once, to
 * tell it their email if they want to be alerted. The visitor types it in
 * the conversation. Then:
 *
 *   no account for that email   an incomplete account is started (a users
 *                               row with no password, like a placeholder
 *                               landlord contact), the email is saved on
 *                               the thread, and the answer is emailed and
 *                               posted here. Signing up later with the same
 *                               email completes that account (signup emails
 *                               a set-password link) and the conversation is
 *                               claimed into it.
 *   a completed account exists  Proxy says so plainly and tells them to log
 *                               in. The question still goes to the landlord,
 *                               but the answer is held off this thread until
 *                               they log in (claim by email), so nobody can
 *                               ask on someone else's behalf and read the
 *                               reply.
 *
 * askedLine() is the sentence Proxy adds to every "sent to the landlord"
 * message so the student knows how the answer will reach them.
 */
import supabase from "@/lib/supabase";
import { updateProxyState } from "./threads";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

// A real account: a way to sign in, or a finished, verified profile (the dev
// snapshot wipes passwords, so a long-standing landlord can show none).
// Proxy's own incomplete accounts are neither.
export const ACCOUNT_FIELDS = "password_hash, google_account, apple_account, email_verified, profile_complete";
export const completedAccount = (u) => !!u && !!(u.password_hash || u.google_account || u.apple_account || (u.email_verified && u.profile_complete));

async function userByEmail(email) {
  const { data } = await supabase.from("users")
    .select(`id, email, name, deleted_at, ${ACCOUNT_FIELDS}`)
    .ilike("email", email.replace(/[\\%_]/g, "\\$&")).limit(1).maybeSingle();
  return data ?? null;
}

async function startIncompleteAccount(email) {
  const { data: role } = await supabase.from("roles").select("id").eq("name", "student").maybeSingle();
  const local = email.split("@")[0].replace(/[._+-]+/g, " ").trim();
  const name = local ? local.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60) : "Proximity student";
  const { data, error } = await supabase.from("users").insert({
    email, name, role_id: role?.id ?? null, email_verified: false, profile_complete: false,
    gender: "unspecified", phone: "N/A", description: "", referral_source: "proxy",
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return userByEmail(email);
    throw new Error(`incomplete account: ${error.message}`);
  }
  return data;
}

/*
 * Whether this visitor message is them giving their email, and what Proxy
 * replies. Returns null when it is an ordinary message.
 */
export async function handleVisitorEmail({ thread, text }) {
  const match = String(text ?? "").match(EMAIL_RE);
  if (!match) return null;
  const email = match[0].toLowerCase();
  const rest = String(text).replace(match[0], "").replace(/[^a-z]/gi, "");
  const asked = !!thread.proxy_state?.notifyAsked;
  // Either Proxy asked for it, or the message is essentially just an address.
  if (!asked && rest.length > 30) return null;

  const user = await userByEmail(email);
  if (user && (completedAccount(user) || user.deleted_at)) {
    await supabase.from("chat_threads").update({ notify_email: email }).eq("id", thread.id);
    await updateProxyState(thread.id, { notifyAsked: true, heldForAccount: user.id });
    const { count } = await supabase.from("listing_question_waiters").select("id", { count: "exact", head: true }).eq("thread_id", thread.id).is("relayed_at", null);
    const waiting = (count ?? 0) > 0;
    return {
      reply: waiting
        ? `That email already has a Proximity account. I've still sent your question to the landlord, but their answer will wait for you there: log in with ${email} and this conversation, with the answer, will be in your Messages.`
        : `That email already has a Proximity account. Log in with ${email} and this conversation will be in your Messages, and anything the landlord answers will reach you there.`,
      held: true, email,
    };
  }
  const stub = user ?? (await startIncompleteAccount(email));
  await supabase.from("chat_threads").update({ notify_email: email }).eq("id", thread.id);
  await updateProxyState(thread.id, { notifyAsked: true, heldForAccount: null, incompleteAccount: stub?.id ?? null });
  return {
    reply: `Got it. I'll email ${email} as soon as the landlord answers, and the answer will show up here too.`,
    held: false, email,
  };
}

/*
 * The closing sentence of a "sent to the landlord" message. Marks the
 * thread as asked so the question is put only once.
 */
export async function askedLine({ thread, userId }) {
  if (userId) {
    const { data: u } = await supabase.from("users").select("email").eq("id", userId).maybeSingle();
    return u?.email ? `I'll email you at ${u.email} as soon as they answer, and it will show up here too.` : "I'll post their answer here as soon as it comes in.";
  }
  const state = thread.proxy_state ?? {};
  if (state.heldForAccount) return "Their answer will be waiting in your Messages once you log in.";
  if (thread.notify_email) return `I'll email you at ${thread.notify_email} as soon as they answer, and it will show up here too.`;
  if (state.notifyAsked) return "I'll post their answer here as soon as it comes in.";
  await updateProxyState(thread.id, { notifyAsked: true });
  thread.proxy_state = { ...state, notifyAsked: true };
  return "If you want to be alerted as soon as they respond, just tell me your email here.";
}

/* Threads whose answers wait for a login: relay skips them until claimed. */
export async function heldThreadIds(threadIds) {
  if (!threadIds.length) return new Set();
  const { data } = await supabase.from("chat_threads").select("id, proxy_state").in("id", threadIds);
  return new Set((data ?? []).filter((t) => t.proxy_state?.heldForAccount).map((t) => t.id));
}
