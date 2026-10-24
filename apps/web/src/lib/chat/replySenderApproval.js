/*
 * Holding, approving and declining emailed replies from someone other than the
 * landlord (Wyatt, 2026-10-24). See lib/chat/replySenders.js for who counts.
 *
 * When a reply to a landlord's conversation comes from an authenticated
 * address that is not theirs and nobody has decided on it, inboundEmail.js
 * stores it as 'held' with a preview, and requestSenderApproval() (in
 * lib/chat/replySenderRequest.js, kept apart to avoid an import cycle) emails
 * the landlord's own account email once per sender, linking to the conversation.
 * There (or in the admin Conversations view) the landlord approves the address
 * or its whole domain, or says "not them":
 *   - approve: every reply held from that sender to that landlord is run again,
 *     oldest first, and posts (dated at approval time, not when it was sent).
 *   - decline: every held reply from that exact address becomes 'wrong_sender'
 *     and later ones are refused without asking again.
 *
 * Forwarded replies and replies that fail the identity check are never held:
 * those are refused as before, so a forged From line cannot get a landlord to
 * approve it.
 */
import supabase from "@/lib/supabase";
import { processInboundEmail } from "@/lib/chat/inboundEmail";
import { domainApprovable, normalizeEmail, patternFor, patternMatches } from "@/lib/chat/replySenders";

/** Held replies in one conversation, for its landlord. */
export async function heldReplies(db, { landlordId, threadId }) {
  const { data, error } = await db
    .from("chat_inbound_emails")
    .select("id, from_email, sender_name, body_preview, created_at, approval_requested_at")
    .eq("user_id", landlordId)
    .eq("thread_id", threadId)
    .eq("status", "held")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    fromEmail: r.from_email,
    senderName: r.sender_name,
    preview: r.body_preview,
    receivedAt: r.created_at,
    landlordAskedAt: r.approval_requested_at,
    canApproveDomain: domainApprovable(r.from_email),
    domain: String(r.from_email ?? "").split("@")[1] ?? null,
  }));
}

/*
 * Run every held reply from senders matching `pattern` to this landlord again.
 * The claim is moved held -> error only if it is still held, so two approvals
 * at once cannot post a reply twice; processInboundEmail then reclaims the
 * 'error' row and runs it with the new decision in place.
 */
async function rerunHeld(landlordId, pattern) {
  const { data: rows, error } = await supabase
    .from("chat_inbound_emails")
    .select("id, s3_key, from_email")
    .eq("user_id", landlordId)
    .eq("status", "held")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const results = [];
  for (const row of (rows ?? []).filter((r) => patternMatches(pattern, r.from_email))) {
    const { data: taken } = await supabase
      .from("chat_inbound_emails")
      .update({ status: "error", reason: "re-run after sender approved" })
      .eq("id", row.id)
      .eq("status", "held")
      .select("id")
      .maybeSingle();
    if (!taken) continue;
    const out = await processInboundEmail({ bucket: process.env.AWS_INBOUND_MAIL_BUCKET, key: row.s3_key });
    results.push({ id: row.id, fromEmail: row.from_email, status: out.status, reason: out.reason ?? null });
  }
  return results;
}

/**
 * Record a decision and act on the held replies it covers.
 *
 * @param {object} input
 * @param {object} input.db         Supabase client for the decision (the admin
 *                                  view may point at the other database)
 * @param {boolean} input.rerun     run held replies again (only when `db` is
 *                                  this environment's own database)
 * @param {"approve"|"decline"} input.decision
 * @param {"address"|"domain"} input.scope  ignored for decline (exact address only)
 * @returns {Promise<{ ok: boolean, error?: string, pattern?: string, results?: Array }>}
 */
export async function decideSender({ db = supabase, landlordId, email, scope = "address", decision, decidedBy, via, rerun = true }) {
  const address = normalizeEmail(email);
  if (!landlordId || !address) return { ok: false, error: "Invalid sender" };
  if (decision !== "approve" && decision !== "decline") return { ok: false, error: "Invalid decision" };
  const pattern = decision === "decline" ? address : patternFor(address, scope);
  if (!pattern) return { ok: false, error: "That domain is shared by many people, so only this exact address can be approved" };

  const { error } = await db.from("landlord_reply_senders").upsert(
    {
      landlord_id: landlordId,
      pattern,
      decision: decision === "approve" ? "approved" : "declined",
      decided_by: decidedBy ?? null,
      decided_via: via,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "landlord_id,pattern" }
  );
  if (error) throw error;

  if (decision === "decline") {
    const { error: declineError } = await db
      .from("chat_inbound_emails")
      .update({ status: "wrong_sender", reason: "declined by landlord" })
      .eq("user_id", landlordId)
      .eq("from_email", address)
      .eq("status", "held");
    if (declineError) throw declineError;
    return { ok: true, pattern, results: [] };
  }

  return { ok: true, pattern, results: rerun ? await rerunHeld(landlordId, pattern) : [] };
}

/** Remove one entry from a landlord's list. Returns false when it is not theirs. */
export async function removeSender(db, { landlordId, id }) {
  const { data, error } = await db
    .from("landlord_reply_senders")
    .delete()
    .eq("id", id)
    .eq("landlord_id", landlordId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
