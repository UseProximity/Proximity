/*
 * What to do for each Stripe event. handleStripeEvent is called once per event
 * by processStripeEvent (webhookEvents.js), which already guarantees an event
 * id that finished processing is never handled twice. A handler may still run
 * twice for one event (Stripe redelivers an event whose first delivery failed),
 * so each one must be safe to repeat.
 *
 * Phase 2 ships the dispatcher only. Handlers are added with the features that
 * need them: payment methods, invoices and payment status, disputes.
 */

// type -> async (event, ctx) => void. ctx is { db }.
export const handlers = {};

export async function handleStripeEvent(event, ctx) {
  const handler = handlers[event.type];
  if (!handler) {
    // Subscribed but nothing to do yet, or an event type we did not ask for.
    return { handled: false };
  }
  await handler(event, ctx);
  return { handled: true };
}
