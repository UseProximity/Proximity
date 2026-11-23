/*
 * The link a listing share sends: always the public listing page,
 * <origin>/listings/<id>, whatever page the sharer is on. That page opens for
 * anyone (an admin sharing from /dashboard/admin sends a link a student can
 * open) and carries the listing's photo and title for chat link previews.
 * Only the selected ?unit= is carried over from the sharer's address. Every
 * other param is left behind: ?preview=1 means nothing to the recipient, and
 * utm_* / gclid would credit the friend's visit to the sharer's ad campaign.
 * Tagged src=share so the marketing beacon counts it as a share
 * (lib/marketing/classify.js).
 * Plain module, no "@/" imports, so the Node test runner can load it.
 */
export const SHARE_SRC = "share";

export function buildShareUrl({ origin, listingId, currentHref } = {}) {
  if (!origin || !listingId) return "";
  const params = new URLSearchParams();
  let unit = null;
  try {
    unit = new URL(currentHref).searchParams.get("unit");
  } catch {
    // No readable address: share the listing without a unit.
  }
  if (unit) params.set("unit", unit);
  params.set("src", SHARE_SRC);
  return `${origin.replace(/\/+$/, "")}/listings/${encodeURIComponent(listingId)}?${params}`;
}

/** Targets that send straight from the panel, for a link and a one-line message. */
export function shareTargets(link, title) {
  const text = title ? `${title} on Proximity` : "Check out this listing on Proximity";
  const message = `${text}: ${link}`;
  return {
    email: `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(message)}`,
    sms: `sms:?&body=${encodeURIComponent(message)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
  };
}
