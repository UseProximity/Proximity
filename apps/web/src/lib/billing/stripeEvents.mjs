/*
 * The Stripe events the webhook endpoint subscribes to. Shared by the setup
 * script (scripts/stripe-setup.mjs), which registers them with Stripe, and by
 * webhookHandlers.js, which has to handle each one. Keep them in step: an event
 * listed here with no handler is acknowledged and ignored.
 *
 * A plain .mjs so the setup script can import it without the Next.js `@/` alias.
 */
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
