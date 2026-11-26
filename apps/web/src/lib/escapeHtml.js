/*
 * Escape a value for interpolation into HTML, element text and quoted attribute
 * values alike. Every value a user typed (names, messages, addresses, listing
 * titles) goes through this before it lands in an email body: otherwise the
 * sender's markup arrives inside Proximity's own trusted template, which is a
 * phishing kit with our domain's reputation on it.
 */
export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
