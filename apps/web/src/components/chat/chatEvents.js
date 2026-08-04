/*
 * Open the floating ChatWidget from anywhere (header badge, listing Message CTA).
 * Same pattern as FeedbackWidget's proximity:open-feedback event.
 */
export const OPEN_MESSAGES_EVENT = "proximity:open-messages";

/**
 * @param {{ threadId?: string, expanded?: boolean }} [detail]
 */
export function openMessages(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_MESSAGES_EVENT, { detail: detail ?? {} })
  );
}
