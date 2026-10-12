import { chatPathFromIncomingLink, isChatLinkRoute } from "../src/lib/chatLinks";

// Expo Router intercepts every incoming deep link — including
// expo-auth-session's native OAuth redirect (see src/lib/googleAuth.js,
// which defaults to `${applicationId}:/oauthredirect`) — and tries to match
// it to a route. Since no route exists at "oauthredirect", it renders
// Unmatched Route. expo-web-browser's own native listener on MainActivity
// already consumes that same incoming intent to resolve the Google sign-in
// promise (see useAuth.js's effect on `response`), so Router should ignore
// this path entirely rather than navigate to it. Returning a falsy value
// here makes Router skip navigation for this URL altogether.
//
// A web link to a conversation (/chat-link?t=<id> from a chat email, or
// /messages?thread=<id>) opens that conversation in the app. Everything else in the
// URL, including the email's magic-link token, is dropped here and never reaches the
// router. The same web paths without a usable thread id land on the Chat tab, since
// the app has no route of that name. Any other URL is passed through unchanged.
export function redirectSystemPath({ path }) {
  if (path.includes("oauthredirect")) {
    return null;
  }
  const chatPath = chatPathFromIncomingLink(path);
  if (chatPath) return chatPath;
  return isChatLinkRoute(path) ? "/(tabs)/chat" : path;
}
