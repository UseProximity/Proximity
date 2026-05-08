/**
 * Returns true if verifiedAt is older than maxDays (default 60).
 * Returns false if verifiedAt is null/undefined — no staleness assumed for unverified records.
 */
export function isStale(verifiedAt, maxDays = 60) {
  if (!verifiedAt) return false;
  return new Date(verifiedAt) < new Date(Date.now() - maxDays * 86_400_000);
}

/**
 * Returns a human-readable label for how long ago a date was.
 * Used for stale tooltips.
 */
export function staleLabel(verifiedAt) {
  if (!verifiedAt) return null;
  const days = Math.floor((Date.now() - new Date(verifiedAt).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? "s" : ""} ago`;
}
