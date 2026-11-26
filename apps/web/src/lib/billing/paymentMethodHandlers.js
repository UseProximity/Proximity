/*
 * Webhook handlers for payment method events, registered in webhookHandlers.js.
 * Each is safe to run twice for one event (see webhookEvents.js): recording is
 * an upsert, removal skips what is already gone.
 *
 *   checkout.session.completed     the landlord finished Checkout in setup mode
 *   setup_intent.succeeded         a bank account that was Verifying is now usable
 *   setup_intent.setup_failed      verification failed: the method is marked Failed, and autopay on it stops
 *   payment_method.updated         expiry or card number refreshed on Stripe's side
 *   payment_method.card_automatically_updated   the card updater replaced an expired card
 *   payment_method.detached        removed on Stripe (our Remove button or the dashboard)
 */
import { getStripe } from "./stripe.js";
import { outstandingBalanceCents } from "./balance.js";
import {
  markPaymentMethodFailed,
  refreshDisplayFields,
  removeByStripeId,
  syncSetupIntent,
} from "./paymentMethods.js";

const idOf = (v) => (v && typeof v === "object" ? v.id : v) ?? null;

// A payer's method became usable: listings waiting on it for the accounts they pay
// for may now go live (Project B). Loaded only then, so tests need no database.
async function releaseForPayer(result) {
  if (result?.userId && result.status === "active") {
    const { afterPayerMethodAdded } = await import("./payerServices.js");
    await afterPayerMethodAdded(result.userId).catch((err) => console.error("billing: release after method failed", err?.message));
  }
}

async function refresh(event, { db }) {
  await refreshDisplayFields(db, event.data.object);
}

export const paymentMethodHandlers = {
  "checkout.session.completed": async (event, { db }) => {
    const session = event.data.object;
    // Checkout is also used in other modes; only setup sessions carry a payment method.
    if (session.mode !== "setup" || !session.setup_intent) return;
    await releaseForPayer(await syncSetupIntent(db, getStripe(), idOf(session.setup_intent)));
  },

  "setup_intent.succeeded": async (event, { db }) => {
    await releaseForPayer(await syncSetupIntent(db, getStripe(), event.data.object.id));
  },

  "setup_intent.setup_failed": async (event, { db }) => {
    const si = event.data.object;
    // Once verification fails the intent may no longer point at the method, but its error does.
    await markPaymentMethodFailed(db, idOf(si.payment_method) ?? si.last_setup_error?.payment_method?.id, { verificationFailed: true });
  },

  "payment_method.updated": refresh,
  // The card updater: handled under both names (see STRIPE_EVENT_ALIASES).
  "payment_method.card_automatically_updated": refresh,
  "payment_method.automatically_updated": refresh,

  "payment_method.detached": async (event, { db }) => {
    const result = await removeByStripeId(db, getStripe(), event.data.object.id);
    // The landlord's last method was removed from Stripe's side: tell the team, like our own Remove does.
    if (result.remaining === 0 && result.userId) {
      const { sendMethodRemovedTeamEmail } = await import("./billingEmails.js");
      const { data: user } = await db.from("users").select("name, email").eq("id", result.userId).maybeSingle();
      await sendMethodRemovedTeamEmail({
        landlordName: user?.name,
        landlordEmail: user?.email,
        outstandingCents: await outstandingBalanceCents(db, result.userId),
      });
    }
  },
};
