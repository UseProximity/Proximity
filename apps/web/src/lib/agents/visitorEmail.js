/*
 * A signed-out visitor's email, given in the chat (Wyatt, 2026-10-27).
 *
 * When Proxy sends a question to the landlord it asks the visitor, once, to
 * tell it their email if they want to be alerted. The visitor types it in
 * the conversation. Nothing is created or sent there except one "confirm
 * this is you" email (PR #365 review, Wyatt 2026-10-31): anyone can type any
 * address. Once the link is clicked:
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
import crypto from "node:crypto";
import supabase from "@/lib/supabase";
import { getBaseUrl, sendProxyConfirmEmail, sendProxyStudentEmail } from "@/lib/email";
import { updateProxyState, PROXY_USER_ID } from "./threads";

// Confirmation links last two days; a conversation gets three of them.
const CONFIRM_TTL_MS = 2 * 24 * 60 * 60 * 1000;
const CONFIRMS_PER_THREAD = 3;
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

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
 * Whether this visitor message gives their email, and what Proxy replies.
 * Returns null for an ordinary message. A message that also asks something
 * ("rent? me@x.com") returns the rest as `question`, which Proxy then
 * answers as usual.
 */
export async function handleVisitorEmail({ thread, text, testEmailTo = null }) {
  const match = String(text ?? "").match(EMAIL_RE);
  if (!match) return null;
  const email = match[0].toLowerCase();
  const rest = String(text).replace(match[0], " ")
    .replace(/\b(my|the)?\s*(e-?mail|address)\s*(is|:)?/gi, " ")
    .replace(/\s+/g, " ").trim();
  const question = rest.replace(/[^a-z]/gi, "").length > 12 ? rest : null;

  const state = thread.proxy_state ?? {};
  const sent = Number(state.confirmsSent ?? 0);
  if (sent >= CONFIRMS_PER_THREAD) {
    return { reply: "I've already sent a few confirmation links from this conversation, so I can't send another. Sign in to get answers by email.", held: false, email, question };
  }
  const token = crypto.randomBytes(24).toString("base64url");
  await updateProxyState(thread.id, {
    notifyAsked: true,
    confirmsSent: sent + 1,
    emailConfirm: { email, hash: hashToken(token), expiresAt: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(), at: new Date().toISOString() },
  });
  const { data: listing } = await supabase.from("listings").select("title, address").eq("id", thread.listing_id).maybeSingle();
  await sendProxyConfirmEmail({
    to: email,
    listingLabel: listing?.title || listing?.address || "a listing",
    confirmUrl: `${getBaseUrl()}/api/proxy/confirm-email?t=${token}`,
    threadId: thread.id,
    testEmailTo,
  });
  return {
    reply: `I've sent a confirmation link to ${email}. Click it and I'll email you there as soon as the landlord answers. The answer will show up here either way.`,
    held: false, email, question,
  };
}

/*
 * The confirmation link was clicked: now the address is the visitor's, so
 * the rules above apply. Any answer that arrived while it was unconfirmed is
 * emailed now. Returns the listing to send them back to, or null for a bad
 * or expired link.
 */
export async function confirmVisitorEmail(token) {
  if (!token || String(token).length < 20) return null;
  const hash = hashToken(token);
  const { data: thread } = await supabase.from("chat_threads")
    .select("id, listing_id, proxy_state, interested_user_id")
    .eq("proxy_state->emailConfirm->>hash", hash).is("deleted_at", null).maybeSingle();
  const pending = thread?.proxy_state?.emailConfirm;
  if (!pending || new Date(pending.expiresAt) < new Date()) return null;
  const email = pending.email;

  const user = await userByEmail(email);
  if (user && (completedAccount(user) || user.deleted_at)) {
    await supabase.from("chat_threads").update({ notify_email: email }).eq("id", thread.id);
    await updateProxyState(thread.id, { emailConfirm: null, heldForAccount: user.id });
    return { listingId: thread.listing_id, existingAccount: true };
  }
  const stub = user ?? (await startIncompleteAccount(email));
  await supabase.from("chat_threads").update({ notify_email: email }).eq("id", thread.id);
  await updateProxyState(thread.id, { emailConfirm: null, heldForAccount: null, incompleteAccount: stub?.id ?? null });

  // An answer relayed while the address waited for confirmation.
  const { data: missed } = await supabase.from("chat_messages").select("body")
    .eq("thread_id", thread.id).eq("sender_id", PROXY_USER_ID).eq("message_type", "proxy_relay").is("deleted_at", null)
    .gte("created_at", pending.at).order("created_at", { ascending: true }).limit(5);
  if (missed?.length) {
    const { data: listing } = await supabase.from("listings").select("title, address").eq("id", thread.listing_id).maybeSingle();
    await sendProxyStudentEmail({
      to: email, name: null, kind: "proxy_relay", listingLabel: listing?.title || listing?.address || "a listing",
      messages: missed.map((m) => m.body), threadUrl: `${getBaseUrl()}/listings/${thread.listing_id}?listingTab=contact`, threadId: thread.id,
    }).catch((err) => console.error("[proxy] missed-answer email failed:", err?.message ?? err));
  }
  return { listingId: thread.listing_id, existingAccount: false };
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
  if (state.emailConfirm?.email) return `Once you click the confirmation link I sent to ${state.emailConfirm.email}, I'll email you their answer. It will show up here too.`;
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
