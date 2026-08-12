/* PostHog is entirely key-gated: without NEXT_PUBLIC_POSTHOG_KEY every export
 * is a no-op, so this can ship before the account exists. The SDK is loaded
 * with a dynamic import so its ~76 KB stays out of the shared bundle until the
 * key is set — until then the browser never downloads it at all.
 * Pageviews (initial load AND client-side navigations) are handled by PostHog's
 * own history-API tracking; we never capture $pageview by hand. */

let clientPromise = null;

// One PostHog project serves all environments; hostname tells them apart so
// staging traffic never pollutes production funnels.
function environmentFromHost() {
  const host = window.location.hostname;
  if (host === "useproximity.org" || host === "www.useproximity.org") return "production";
  if (host === "localhost" || host === "127.0.0.1") return "development";
  return "staging";
}

function client() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined") return null;
  if (!clientPromise) {
    clientPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(key, {
          api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
          capture_pageview: "history_change", // initial load + SPA navigations, no double-counting
          capture_pageleave: true,
          // Every event we care about is an explicit trackEvent() call; autocapture
          // would additionally record the text of whatever the student clicked.
          autocapture: false,
          // Replay must not carry student PII: mask form inputs and all rendered
          // text (names, emails, chat messages) — shapes and layout still record.
          session_recording: { maskAllInputs: true, maskTextSelector: "*" },
        });
        posthog.register({ environment: environmentFromHost() });
        return posthog;
      })
      .catch(() => null);
  }
  return clientPromise;
}

export function phInit() {
  try { client(); } catch {}
}

export function phCapture(eventName, props) {
  try { client()?.then((ph) => ph?.capture(eventName, props)); } catch {}
}
