function getSessionId() {
  if (typeof window === "undefined") return null;
  let id = sessionStorage.getItem("prx_sid");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("prx_sid", id);
  }
  return id;
}

export function trackEvent(eventType, metadata = {}, userId = null) {
  try {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType,
        page: typeof window !== "undefined" ? window.location.pathname : null,
        metadata,
        userId,
        sessionId: getSessionId(),
      }),
    }).catch(() => {});
  } catch {}
}

export function trackSessionEnd(userId = null) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({
    eventType: "session_end",
    page: window.location.pathname,
    metadata: {},
    userId,
    sessionId: getSessionId(),
  });
  navigator.sendBeacon(
    "/api/events",
    new Blob([payload], { type: "application/json" })
  );
}
