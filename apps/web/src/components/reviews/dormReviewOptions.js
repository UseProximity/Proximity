/*
 * The tag chips offered when reviewing a dorm.
 *
 * Two surfaces write dorm reviews now (the Campus Hub's inline form and the
 * on-campus branch of /review), and a tag only groups dorms usefully if both
 * offer the identical list. Tag names resolve to rows in `tags` case-insensitively
 * on the server, which is also where a genuinely new one gets created.
 *
 * Client-safe; no server imports.
 */
export const DORM_FORM_TAGS = [
  "Quiet Floor",
  "Study Floor",
  "Social Floor",
  "Historic",
  "New Building",
  "Central Location",
  "Apartment Style",
  "Modern",
];
