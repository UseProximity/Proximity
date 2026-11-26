/*
 * The Stripe events the webhook endpoint subscribes to. Shared by the setup
 * script (scripts/stripe-setup.mjs), which registers them with Stripe, and by
 * webhookHandlers.js, which has to handle each one. Keep them in step: an event
 * listed here with no handler is acknowledged and ignored.
 *
 * A plain .mjs so the setup script can import it without the Next.js `@/` alias.
 */
/*
 * Event types Stripe delivers under a different name from the one the endpoint
 * is subscribed with: delivered type -> subscribed name. The card updater is
 * subscribed as payment_method.card_automatically_updated (what the endpoint
 * stores), but Stripe's event reference documents the delivered type as
 * payment_method.automatically_updated, so both are handled.
 */
export const STRIPE_EVENT_ALIASES = {
  "payment_method.automatically_updated": "payment_method.card_automatically_updated",
};

export const STRIPE_WEBHOOK_EVENTS = [
  // Payment method setup (Checkout in setup mode, bank verification)
  "checkout.session.completed",
  "setup_intent.succeeded",
  "setup_intent.setup_failed",
  "payment_method.attached",
  "payment_method.detached",
  "payment_method.updated",
  "payment_method.card_automatically_updated",
  "customer.updated",

  // Monthly invoices
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.voided",
  "invoice.marked_uncollectible",
  "payment_intent.processing",

  // Corrections and chargebacks
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
];
