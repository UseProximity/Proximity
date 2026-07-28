// No standalone date-formatting utility exists on web to port verbatim — web
// formats dates inline wherever needed (e.g. ListingModalInfo.js's review
// dates), always via `toLocaleDateString("en-US", {...})`. This mirrors that
// exact pattern as a single reusable helper for mobile.
export function formatDate(dateInput, options = { month: "long", day: "numeric", year: "numeric" }) {
  if (!dateInput) return null;
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", options);
}
