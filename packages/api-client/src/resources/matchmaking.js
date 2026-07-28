// Wraps GET/POST/PATCH /api/matchmaking/chat (apps/web/src/app/api/matchmaking/chat/route.js).
// Falls back to a shared guest identity server-side whenever isProdData() is
// false (staging/dev/local), so this is usable unauthenticated during
// development but will 401 against real production until Phase 5 auth exists.
export function createMatchmakingResource(client) {
  return {
    // Resumes the caller's most recent non-abandoned session, if any.
    getSession: () => client.request("/api/matchmaking/chat"),

    // A normal conversation turn: free-text `message` and/or a structured
    // `answer` to the previous `nextQuestion`.
    sendTurn: ({ sessionId, message, answer, preferences, weights, tradeoff } = {}) =>
      client.request("/api/matchmaking/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId, message, answer, preferences, weights, tradeoff }),
      }),

    // Rewinds a session to an earlier point in the transcript.
    rewind: ({ sessionId, transcript, preferences, weights }) =>
      client.request("/api/matchmaking/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId, action: "rewind", transcript, preferences, weights }),
      }),

    // Sends the contact-landlord flow for one or more recommended listings.
    contactOwners: ({ sessionId, listingIds, message, selectionLabel }) =>
      client.request("/api/matchmaking/chat", {
        method: "POST",
        body: JSON.stringify({ sessionId, action: "contact_owners", listingIds, message, selectionLabel }),
      }),

    // Panel-driven preference/weight edits outside the chat turn flow.
    updateSession: ({ sessionId, patch, weights }) =>
      client.request("/api/matchmaking/chat", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, patch, weights }),
      }),
  };
}
