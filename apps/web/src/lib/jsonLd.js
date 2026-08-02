/*
 * Serialize an object for embedding in a <script type="application/ld+json">
 * tag. JSON.stringify alone is NOT safe for script-tag embedding: it leaves
 * "<" intact, so a user-controlled string containing "</script>" would
 * terminate the tag early and inject live markup (stored XSS). Escaping "<"
 * to its JSON unicode escape form is semantically identical JSON but inert
 * inside HTML.
 */
export function serializeJsonLd(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
