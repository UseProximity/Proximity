/*
 * What an Amazon SES event means for a chat_email_log row (Wyatt, 2026-10-23).
 * Used by /api/ses/events. Kept free of app imports so the node test runner
 * can load it directly.
 */

// Which statuses each event may replace. Bad news always lands; good news never
// overwrites it.
export const TRANSITIONS = {
  delivered: ["sent", "delayed"],
  delayed: ["sent", "delayed"],
  bounced: ["sent", "delayed", "delivered"],
  complained: ["sent", "delayed", "delivered", "bounced"],
  rejected: ["sent", "delayed"],
  failed: ["sent", "delayed"],
};

export function statusOf(type, event) {
  switch (type) {
    case "Delivery":
      return { status: "delivered", detail: event.delivery?.smtpResponse ?? null };
    case "DeliveryDelay":
      return { status: "delayed", detail: event.deliveryDelay?.delayType ?? null };
    case "Bounce": {
      const b = event.bounce ?? {};
      const why = [b.bounceType, b.bounceSubType, b.bouncedRecipients?.[0]?.diagnosticCode].filter(Boolean).join(": ");
      // A soft bounce is still being retried by SES.
      return b.bounceType === "Permanent"
        ? { status: "bounced", detail: why }
        : { status: "delayed", detail: `soft bounce, ${why}` };
    }
    case "Complaint":
      return { status: "complained", detail: event.complaint?.complaintFeedbackType ?? "marked as spam" };
    case "Reject":
      return { status: "rejected", detail: event.reject?.reason ?? null };
    case "Rendering Failure":
      return { status: "failed", detail: event.failure?.errorMessage ?? "rendering failure" };
    default:
      return null;
  }
}
