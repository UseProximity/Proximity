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
  { key: "billing", label: "Billing" },
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
  parent_guide: ["account", "Parent guide"],
  landlord_nudge: ["landlords", "Landlord nudge"],
  owner_inquiry: ["landlords", "Owner inquiry"],
  new_listing: ["landlords", "New listing notice"],
  co_landlord_added: ["landlords", "Co-landlord added"],
  landlord_review: ["landlords", "New review for landlord"],
  availability_check: ["landlords", "Availability check"],
  auto_unavailable_review: ["team", "Auto-unavailable review"],
  pms_sync_digest: ["landlords", "PMS sync digest"],
  billing_contest_outcome: ["billing", "Contested charge outcome"],
  billing_payment_failed: ["billing", "Payment failed"],
  billing_method_attention: ["billing", "Payment method needs updating"],
  billing_overdue: ["billing", "Overdue invoice, listings hidden"],
  billing_enrollment: ["billing", "Payments setup invitation"],
  billing_agreement_request: ["billing", "Commission agreement to sign"],
  billing_invoice_issued: ["billing", "Monthly invoice"],
  billing_autopay_off: ["billing", "Autopay switched off"],
  billing_agreement_declined_team: ["billing", "Agreement declined (to team)"],
  billing_contest_submitted: ["billing", "Charge contested (to team)"],
  billing_payment_failed_team: ["billing", "Payment failed (to team)"],
  billing_overdue_team: ["billing", "Leases withdrawn (to team)"],
  billing_chargeback_team: ["billing", "Chargeback received (to team)"],
  billing_method_removed_team: ["billing", "Only payment method removed (to team)"],
  team_alert: ["team", "Team alert"],
  chat_checkin_digest: ["team", "Daily chat check-in"],
  chat_checkin_report: ["team", "Weekly chat report"],
  content_report: ["team", "Content report"],
  contact_mismatch: ["team", "Landlord contact mismatch"],
  feedback: ["team", "Site feedback"],
  proxy_answer: ["chat", "Proxy answered a student"],
  proxy_relay: ["chat", "Landlord answer relayed by Proxy"],
  proxy_clarifier: ["chat", "Landlord asked the student something via Proxy"],
  proxy_correction: ["chat", "Landlord update to an earlier Proxy answer"],
  proxy_reply: ["chat", "Proxy's reply to a student who wrote by email"],
  proxy_no_answer: ["chat", "Proxy: no answer from the landlord yet"],
  tour_request: ["landlords", "Tour request"],
  tour_proposal: ["chat", "Tour: landlord proposed times"],
  tour_confirmed: ["chat", "Tour confirmed"],
  tour_cancelled: ["chat", "Tour cancelled"],
  tour_reminder: ["chat", "Tour reminder"],
  tour_no_answer: ["chat", "Tour: no answer from the landlord"],
  proxy_question: ["landlords", "Question from a student (via Proxy)"],
  proxy_reminder: ["landlords", "Unanswered question reminder"],
  agent_digest: ["team", "Agents daily digest"],
  availability_gone: ["landlords", "Unit or listing gone from website"],
  source_sync_digest: ["team", "Website sync digest"],
  source_sync_failure: ["team", "Website sync failure"],
  import_cap_alert: ["team", "Website import cap reached"],
};

export function categoryOf(kind) {
  return KINDS[kind]?.[0] ?? "other";
}

export function kindLabel(kind) {
  return KINDS[kind]?.[1] ?? String(kind ?? "other").replace(/_/g, " ");
}
