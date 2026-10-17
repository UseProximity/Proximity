// Pure helpers for opening a conversation from a link. No imports, so both the
// native-intent hook and the login screens can use them.
//
// A link only ever names a conversation; it never proves access to one. The chat
// screen and the API still decide whether the signed-in user may read the thread.
// The email's magic-link token is never read here: the whole query string is dropped
// apart from the one thread id, and that id must be a strict UUID.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEB_HOSTS = new Set(["useproximity.org", "www.useproximity.org"]);
const APP_SCHEMES = new Set(["proximity:", "org.useproximity.app:"]);
// The only web paths that map to a conversation, and the query key carrying its id.
const LINK_ROUTES = { "/chat-link": "t", "/messages": "thread" };

// scheme:, //authority, path, ?query (a fragment is ignored). Written by hand because
// React Native's URL implementation is incomplete.
const URL_PARTS = /^(?:([a-z][a-z0-9+.-]*:))?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i;

// Splits a supported link form into the query key that carries its thread id and the
// raw query string, or null for anything else (other hosts, other paths). Accepts a
// relative path, an https URL on the Proximity site, or the app's own scheme with no
// host.
function parseChatLink(input) {
  if (typeof input !== "string") return null;
  const match = URL_PARTS.exec(input.trim());
  if (!match) return null;
  const scheme = match[1]?.toLowerCase();
  const authority = match[2];
  const pathname = match[3] ?? "";
  const query = match[4] ?? "";

  if (scheme === "https:") {
    if (authority === undefined || !WEB_HOSTS.has(authority.toLowerCase())) return null;
  } else if (scheme !== undefined && APP_SCHEMES.has(scheme)) {
    if (authority) return null;
  } else if (scheme !== undefined || authority !== undefined) {
    return null;
  }

  const key = LINK_ROUTES[pathname.replace(/\/+$/, "")];
  return key ? { key, query } : null;
}

// True for a link on one of the conversation web paths, whether or not it carries a
// usable thread id. Lets the native-intent hook send a bare /messages link to the Chat
// tab instead of a route the app does not have.
export function isChatLinkRoute(input) {
  return parseChatLink(input) !== null;
}

// Returns the conversation path "/chat/<uuid>" for one of the supported link forms, or
// null for anything else (other hosts, other paths, a missing, repeated or malformed
// id).
export function chatPathFromIncomingLink(input) {
  const link = parseChatLink(input);
  if (!link) return null;

  const values = [];
  for (const pair of link.query.split("&")) {
    const eq = pair.indexOf("=");
    const name = eq === -1 ? pair : pair.slice(0, eq);
    if (name !== link.key) continue;
    try {
      values.push(decodeURIComponent(eq === -1 ? "" : pair.slice(eq + 1)));
    } catch {
      return null;
    }
  }
  if (values.length !== 1 || !UUID_RE.test(values[0])) return null;
  return `/chat/${values[0].toLowerCase()}`;
}

// A return destination handed to the login screen. Only a conversation path is accepted,
// so the parameter cannot be used to send someone anywhere else in the app. Returns the
// normalised path, or null.
export function safeReturnPath(value) {
  if (typeof value !== "string") return null;
  const match = /^\/chat\/([0-9a-f-]{36})$/i.exec(value);
  if (!match || !UUID_RE.test(match[1])) return null;
  return `/chat/${match[1].toLowerCase()}`;
}
