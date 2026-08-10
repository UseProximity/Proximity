import posthog from "posthog-js";

/* PostHog is entirely key-gated: without NEXT_PUBLIC_POSTHOG_KEY every export
 * is a no-op (no network calls), so this can ship before the account exists.
 * Init is lazy — the first analytics call (Header's route tracker on mount)
 * boots the client, which also fires the initial $pageview. */

let initialized = false;

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
  if (!initialized) {
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      capture_pageview: true,   // full page loads; SPA navigations are captured in recordPageVisit
      capture_pageleave: true,
      session_recording: { maskAllInputs: true },
    });
    posthog.register({ environment: environmentFromHost() });
    initialized = true;
  }
  return posthog;
}

export function phInit() {
  try { client(); } catch {}
}

export function phCapture(eventName, props) {
  try { client()?.capture(eventName, props); } catch {}
}

// Client-side route changes don't reload the page, so $pageview must be sent
// manually; the initial load's $pageview comes from capture_pageview above.
export function phSpaPageview() {
  try { client()?.capture("$pageview"); } catch {}
}
