/*
 * The one Stripe client for the app, and the three env vars it reads:
 *
 *   STRIPE_SECRET_KEY       server only. sk_test_ / rk_test_ off production,
 *                           a restricted rk_live_ key on production.
 *   STRIPE_PUBLISHABLE_KEY  safe for the browser.
 *   STRIPE_WEBHOOK_SECRET   whsec_..., verifies /api/webhooks/stripe.
 *
 * Preview, staging and local use sandbox values; production uses live ones that
 * Proximity enters itself. Going live is a config change, never a code change.
 *
 * Fail-safe like appEnv.js: anything that is not production refuses a live key,
 * so a mis-pasted variable can never move real money from staging or a preview.
 */
import Stripe from "stripe";
import { isProdData } from "../appEnv.js";

const TEST_KEY = /^(sk|rk)_test_/;

let client = null;
let clientKey = null;

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY env var");
  if (!isProdData() && !TEST_KEY.test(key)) {
    throw new Error("Refusing to use a non-sandbox Stripe key outside production");
  }
  // Rebuilt if the key changes (tests, env reloads); otherwise one shared client.
  if (!client || clientKey !== key) {
    client = new Stripe(key, {
      maxNetworkRetries: 2,
      appInfo: { name: "Proximity" },
    });
    clientKey = key;
  }
  return client;
}

export function stripePublishableKey() {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Missing STRIPE_PUBLISHABLE_KEY env var");
  return key;
}

export function stripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET env var");
  return secret;
}
