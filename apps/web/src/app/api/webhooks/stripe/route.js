export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { isProdData } from "@/lib/appEnv";
import { getStripe, stripeWebhookSecret } from "@/lib/billing/stripe";
import { processStripeEvent } from "@/lib/billing/webhookEvents";

/*
 * Stripe webhook receiver: invoice and payment status, payment method updates
 * and disputes all arrive here.
 *
 * The signature is checked against the raw body before anything else is read,
 * so an unsigned or tampered request never reaches the database. Stripe
 * redelivers until it gets a 2xx, so a failure answers 500 and a duplicate or
 * ignored event answers 200 (see lib/billing/webhookEvents.js).
 *
 * @auth Stripe signature (STRIPE_WEBHOOK_SECRET)
 */
export async function POST(req) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let secret;
  try {
    secret = stripeWebhookSecret();
  } catch {
    console.error("stripe webhook: STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // The raw text, not req.json(): the signature covers the exact bytes sent.
  const body = await req.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Off production only sandbox events are ever acted on, whatever the endpoint
  // was pointed at. Acknowledge so Stripe does not keep retrying it.
  if (event.livemode && !isProdData()) {
    return NextResponse.json({ received: true, status: "ignored_livemode" });
  }

  try {
    const result = await processStripeEvent(supabase, event);
    return NextResponse.json({ received: true, status: result.status });
  } catch (err) {
    console.error("stripe webhook: processing failed", event.id, event.type, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
