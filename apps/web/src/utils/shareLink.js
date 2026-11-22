/*
 * The link a listing share sends. It is the page the visitor is on, tagged
 * src=share so the marketing beacon (lib/marketing/tags.js reads src) can count
 * visits that came from a share. `src` joins an existing query string with &
 * and replaces a src already there rather than doubling it. The landlord's
 * ?preview=1 and the #hash are dropped: they mean nothing to the recipient.
 * Plain module, no "@/" imports, so the Node test runner can load it.
 */
export const SHARE_SRC = "share";

export function buildShareUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return String(href ?? "");
  }
  url.hash = "";
  url.searchParams.delete("preview");
  url.searchParams.delete("src");
  // Appended last, and by hand, so the other params keep their order and
  // spelling (URLSearchParams.toString would re-encode them).
  const rest = url.search;
  url.search = "";
  return `${url.toString()}${rest ? `${rest}&` : "?"}src=${SHARE_SRC}`;
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
