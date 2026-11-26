// Reasons a user can give when reporting a listing. The values are what
// listing_reports.reason stores (and its CHECK constraint allows); the labels are what
// every client shows.
export const LISTING_REPORT_REASONS = [
  { value: "misleading_or_fake", label: "Misleading or fake listing" },
  { value: "scam_or_fraud", label: "Scam / fraud" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "discriminatory", label: "Discriminatory language" },
  { value: "other", label: "Other" },
];

export const LISTING_REPORT_REASON_VALUES = LISTING_REPORT_REASONS.map((reason) => reason.value);

// Longest optional note a report may carry (listing_reports.details CHECK).
export const LISTING_REPORT_DETAILS_MAX = 500;
