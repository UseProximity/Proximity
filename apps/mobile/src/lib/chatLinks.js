// Pure helpers for opening a conversation from a link. No imports, so both the
// native-intent hook and the login screens can use them.
//
// A link only ever names a conversation; it never proves access to one. The chat
// screen and the API still decide whether the signed-in user may read the thread.
// The email's magic-link token is never read here: the whole query string is dropped
// apart from the one thread id, and that id must be a strict UUID.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The staging host is accepted too: the app only receives a link for a host its build
// claims (src/lib/linkDomains.js), and only staging-backed builds claim that one.
const WEB_HOSTS = new Set(["useproximity.org", "www.useproximity.org", "proximity-livid.vercel.app"]);
const APP_SCHEMES = new Set(["proximity:", "org.useproximity.app:"]);
// The only web paths that map to a conversation, and the query key carrying its id.
const LINK_ROUTES = { "/chat-link": "t", "/messages": "thread" };

// scheme:, //authority, path, ?query (a fragment is ignored). Written by hand because
// React Native's URL implementation is incomplete.
const URL_PARTS = /^(?:([a-z][a-z0-9+.-]*:))?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i;

// Splits a supported link form into its path (trailing slashes removed) and raw query
// string, or null for anything else (other hosts, unknown schemes). Accepts a relative
// path, an https URL on the Proximity site, or the app's own scheme with no host.
function splitSupportedLink(input) {
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

  return { pathname: pathname.replace(/\/+$/, ""), query };
}

// The value of `key` in a raw query string, only when it appears exactly once and is
// well-formed; null otherwise.
function singleQueryValue(query, key) {
  const values = [];
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const name = eq === -1 ? pair : pair.slice(0, eq);
    if (name !== key) continue;
    try {
      values.push(decodeURIComponent(eq === -1 ? "" : pair.slice(eq + 1)));
    } catch {
      return null;
    }
  }
  return values.length === 1 ? values[0] : null;
}

// The query key that carries a thread id, plus the raw query string, for a conversation
// link; null for anything else (other hosts, other paths).
function parseChatLink(input) {
  const link = splitSupportedLink(input);
  const key = link ? LINK_ROUTES[link.pathname] : undefined;
  return key ? { key, query: link.query } : null;
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

  const value = singleQueryValue(link.query, link.key);
  if (value === null || !UUID_RE.test(value)) return null;
  return `/chat/${value.toLowerCase()}`;
}

// The password-reset and email-verification emails link to these web paths, each with the
// one-time token the server generated (a UUID). Returns { kind, path, token } for a link
// on one of them, where `path` is the app screen and `token` is the UUID, or null when it
// is missing, repeated or malformed. A link on these paths always gets a screen, even
// without a usable token, so it never reaches a route the app does not have. Any other
// link returns null.
const AUTH_LINK_ROUTES = {
  "/reset-password": { kind: "reset", path: "/reset-password" },
  "/api/auth/verify-email": { kind: "verify", path: "/verify-email" },
};

export function authLinkFromIncomingLink(input) {
  const link = splitSupportedLink(input);
  const route = link ? AUTH_LINK_ROUTES[link.pathname] : undefined;
  if (!route) return null;
  const token = singleQueryValue(link.query, "token");
  return { kind: route.kind, path: route.path, token: token !== null && UUID_RE.test(token) ? token : null };
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
