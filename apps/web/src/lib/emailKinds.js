/*
 * The categories and labels for the admin "Sent emails" page (Wyatt,
 * 2026-10-24). Each email is labelled with a kind where it is sent
 * (`logAs: { kind }`, see lib/outreach.js); the kind decides its tab. Kept apart
 * from lib/emailLog.js so the page can import it without the database client.
 */

export const CATEGORIES = [
  { key: "chat", label: "Chat" },
  { key: "account", label: "Account" },
  { key: "reviews", label: "Reviews & waitlist" },
  { key: "landlords", label: "Landlords" },
  { key: "team", label: "Team (internal)" },
  { key: "other", label: "Other" },
];

// kind -> [category, plain-words label]
export const KINDS = {
  chat_alert: ["chat", "New message alert"],
  chat_reminder: ["chat", "Reply reminder"],
  reply_not_delivered: ["chat", "Emailed reply not delivered"],
  reply_guidelines: ["chat", "Emailed reply guidelines"],
  reply_sender_approval: ["chat", "Reply sender approval request"],
  contact_verification: ["chat", "Landlord contact verification"],
  password_reset: ["account", "Password reset"],
  verification: ["account", "Email verification"],
  review_confirmation: ["reviews", "Review confirmation"],
  review_invite: ["reviews", "Review invite"],
  waitlist_nudge: ["reviews", "Waitlist nudge"],
  landlord_nudge: ["landlords", "Landlord nudge"],
  owner_inquiry: ["landlords", "Owner inquiry"],
  new_listing: ["landlords", "New listing notice"],
  co_landlord_added: ["landlords", "Co-landlord added"],
  landlord_review: ["landlords", "New review for landlord"],
  availability_check: ["landlords", "Availability check"],
  auto_unavailable_review: ["team", "Auto-unavailable review"],
  pms_sync_digest: ["landlords", "PMS sync digest"],
  team_alert: ["team", "Team alert"],
  chat_checkin_digest: ["team", "Daily chat check-in"],
  chat_checkin_report: ["team", "Weekly chat report"],
  content_report: ["team", "Content report"],
  contact_mismatch: ["team", "Landlord contact mismatch"],
  feedback: ["team", "Site feedback"],
};

export function categoryOf(kind) {
  return KINDS[kind]?.[0] ?? "other";
}

export function kindLabel(kind) {
  return KINDS[kind]?.[1] ?? String(kind ?? "other").replace(/_/g, " ");
}
