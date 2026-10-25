/*
 * Builds the apple-app-site-association document served at
 * /.well-known/apple-app-site-association (see app/.well-known/.../route.js).
 *
 * Every build of the iOS app already claims this domain, so whatever paths are listed here
 * are opened in the app by builds that may predate the screens for them. The password-reset
 * and email-verification paths are therefore listed only when APP_LINKS_AUTH_PATHS is
 * deliberately set (to "1" or "true"), which must not happen on production until an app
 * build that handles them is released. The chat paths are always listed.
 *
 * Apple evaluates `components` in order and the first match wins; a match with
 * `exclude: true` stops matching and keeps the URL out of the app. So the exclusion for
 * verification links carrying `next` must come before the verification path itself. Those
 * links stay in Safari: the app cannot open a web callback destination, and the web flow
 * already returns the person to it after verifying.
 */

const APP_ID = "KU975HTP7L.com.proximityllc.proximity";

export function authPathsEnabled(flag = process.env.APP_LINKS_AUTH_PATHS) {
  const value = String(flag ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

export function buildAasa({ authPaths = false } = {}) {
  const components = [{ "/": "/chat-link" }, { "/": "/messages" }];

  if (authPaths) {
    components.push(
      { "/": "/api/auth/verify-email", "?": { next: "?*" }, exclude: true },
      { "/": "/reset-password" },
      { "/": "/api/auth/verify-email" }
    );
  }

  return { applinks: { details: [{ appIDs: [APP_ID], components }] } };
}
