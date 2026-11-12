/*
 * The browser half of the site error alerts (Wyatt, 2026-11-03): send one
 * crash to /api/errors. A page reports at most MAX_PER_PAGE distinct
 * problems, each once, so a loop that throws on every frame sends one report.
 */
const MAX_PER_PAGE = 5;
const sent = new Set();

export function reportBrowserError(error, kind = "error") {
  try {
    if (typeof window === "undefined") return;
    const message = String(error?.message ?? error ?? "").slice(0, 2000);
    if (!message) return;
    const key = `${kind}:${message}`;
    if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
    sent.add(key);
    const body = JSON.stringify({
      message,
      stack: typeof error?.stack === "string" ? error.stack.slice(0, 8000) : null,
      path: window.location.pathname,
      kind,
    });
    fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // reporting must never cause a second failure
  }
}
