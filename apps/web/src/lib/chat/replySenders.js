/*
 * Who else may reply by email on a landlord's behalf (Wyatt, 2026-10-24).
 *
 * An emailed reply is posted when it comes from the landlord's account email,
 * the alert address the conversation emails, or the same company domain
 * (lib/chat/inboundEmail.js). Anyone else is refused, unless the landlord or
 * the Proximity team has approved them here, as one address
 * ('vic@revivalstl.com') or a whole company domain ('@revivalstl.com').
 *
 * A reply from someone not yet decided on is held, and the landlord is asked
 * once (lib/chat/replySenderApproval.js). An exact "not them" decision always
 * wins over an approved domain, so one person at an approved company can still
 * be shut out.
 *
 * Kept free of app imports so the node test runner can load the pure helpers;
 * the lookups take the Supabase client as an argument.
 */

// Sharing one of these domains says nothing about being the same business, so
// they can only ever be approved one address at a time.
export const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com",
  "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "gmx.us", "mail.com", "yandex.com", "zoho.com",
  "zohomail.com", "fastmail.com", "hey.com", "att.net", "sbcglobal.net", "comcast.net",
  "verizon.net", "charter.net", "wustl.edu",
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email) {
  const e = String(email ?? "").trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

export function domainOfEmail(email) {
  return String(email ?? "").trim().toLowerCase().split("@")[1] || "";
}

/** Can this address's whole domain be approved? */
export function domainApprovable(email) {
  const domain = domainOfEmail(email);
  return Boolean(domain) && !SHARED_DOMAINS.has(domain);
}

/**
 * The stored pattern for approving `email` alone ("address") or everyone at its
 * domain ("domain"). Null when the input is not an email, or a domain approval
 * is asked for a shared mail domain.
 */
export function patternFor(email, scope) {
  const e = normalizeEmail(email);
  if (!e) return null;
  if (scope === "domain") return domainApprovable(e) ? `@${domainOfEmail(e)}` : null;
  return e;
}

/** Does `pattern` cover `email`? */
export function patternMatches(pattern, email) {
  const e = normalizeEmail(email);
  if (!e || !pattern) return false;
  return pattern.startsWith("@") ? e.endsWith(pattern) : e === pattern;
}

/**
 * Pure: the decision for `email` given a landlord's rows. 'declined' on the
 * exact address wins; then an approval of the address or its domain; else null
 * (nobody has decided).
 */
export function decisionFrom(rows, email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const exact = rows.find((r) => r.pattern === e);
  if (exact?.decision === "declined") return "declined";
  if (exact?.decision === "approved") return "approved";
  const domain = rows.find((r) => r.pattern === `@${domainOfEmail(e)}`);
  return domain?.decision === "approved" ? "approved" : null;
}

/** 'approved', 'declined' or null for `email` replying on `landlordId`'s behalf. */
export async function senderDecision(supabase, landlordId, email) {
  const e = normalizeEmail(email);
  if (!landlordId || !e) return null;
  const { data, error } = await supabase
    .from("landlord_reply_senders")
    .select("pattern, decision")
    .eq("landlord_id", landlordId)
    .in("pattern", [e, `@${domainOfEmail(e)}`]);
  if (error) {
    // Fail closed: an unknown decision holds the reply, it never posts it.
    console.error("senderDecision failed:", error);
    return null;
  }
  return decisionFrom(data ?? [], e);
}

/** A landlord's whole list, newest first. */
export async function listReplySenders(supabase, landlordId) {
  const { data, error } = await supabase
    .from("landlord_reply_senders")
    .select("id, pattern, decision, decided_via, created_at, updated_at")
    .eq("landlord_id", landlordId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    pattern: r.pattern,
    isDomain: r.pattern.startsWith("@"),
    decision: r.decision,
    decidedVia: r.decided_via,
    updatedAt: r.updated_at,
  }));
}
