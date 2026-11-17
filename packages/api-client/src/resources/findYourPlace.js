// Wraps POST /api/find-your-place (apps/web/src/app/api/find-your-place/route.js).
// Auth is optional on the server, but the app only calls it signed in, so the
// search is saved to the account (and feeds "Suggested for you").
export function createFindYourPlaceResource(client) {
  return {
    // One search. Passing the previous `sessionId` updates that search instead of
    // starting another; `retry` is true only for a search the student asked to try
    // again. Answers { sessionId, signedIn, matches, totalMatches, browse }.
    run: ({ answers, text, chips, sessionId, retry = false }, { signal } = {}) =>
      client.request("/api/find-your-place", {
        method: "POST",
        body: JSON.stringify({ answers, text, chips, sessionId, retry }),
        signal,
      }),
  };
}
