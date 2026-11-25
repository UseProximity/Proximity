/*
 * The weekly read's status for a page it did not send to the model because
 * another page says the same (an exact copy, or a page in another language),
 * so the facts filed under it are counted the right way (pages.js
 * noteMissingFacts). No imports, so node --test can load it
 * (pageStatus.test.js).
 *
 *   twinStatus    "read" or "unchanged" for the page it copies this week, or
 *                 null when that page has no status (never crawled, as with a
 *                 translated slug like /es/sobre-nosotros beside /about-us)
 *   fetched       whether the copy itself was fetched this week (its text is
 *                 then in the site text the excerpt check reads)
 *   ownUnchanged  whether the copy's own text matches the fingerprint stored
 *                 for it
 *
 * Returns "read", "unchanged" or null (no status: its facts are left alone
 * this week).
 *
 * A copy is only "unchanged" when its own text is (PR 478 review): a removed
 * page that now redirects to the unchanged home page is a copy of it, and
 * calling it unchanged kept its old facts alive every week. Otherwise it
 * counts as read, so its facts must still be stated or still be on the site.
 * A copy fetched this week whose twin has no status still gets one, so the
 * usual two-read rule applies to it (PR 478 review).
 */
export function copyReadStatus({ twinStatus = null, fetched = false, ownUnchanged = false }) {
  if (twinStatus === "read") return "read";
  if (!fetched) return twinStatus === "unchanged" ? "unchanged" : null;
  return ownUnchanged ? "unchanged" : "read";
}
