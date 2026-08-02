// Expo Router intercepts every incoming deep link — including
// expo-auth-session's native OAuth redirect (see src/lib/googleAuth.js,
// which defaults to `${applicationId}:/oauthredirect`) — and tries to match
// it to a route. Since no route exists at "oauthredirect", it renders
// Unmatched Route. expo-web-browser's own native listener on MainActivity
// already consumes that same incoming intent to resolve the Google sign-in
// promise (see useAuth.js's effect on `response`), so Router should ignore
// this path entirely rather than navigate to it. Returning a falsy value
// here makes Router skip navigation for this URL altogether.
export function redirectSystemPath({ path }) {
  if (path.includes("oauthredirect")) {
    return null;
  }
  return path;
}
