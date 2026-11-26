// Reasons a user can give when reporting a chat conversation or message. The
// values are what chat_reports.reason stores (and its CHECK constraint allows);
// the labels are what every client shows.
export const CHAT_REPORT_REASONS = [
  { value: "harassment", label: "Harassment" },
  { value: "scam_or_fraud", label: "Scam / fraud" },
  { value: "spam", label: "Spam" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];

export const CHAT_REPORT_REASON_VALUES = CHAT_REPORT_REASONS.map((reason) => reason.value);
