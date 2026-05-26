import { track } from "@vercel/analytics";
import { sendGAEvent } from "@next/third-parties/google";

export function trackEvent(eventName, props = {}) {
  try { track(eventName, props); } catch {}
  try { sendGAEvent("event", eventName, props); } catch {}
}
