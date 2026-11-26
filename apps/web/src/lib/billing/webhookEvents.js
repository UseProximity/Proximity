/*
 * Idempotent processing of a verified Stripe event, backed by
 * stripe_webhook_events (202610310001).
 *
 * The event id is claimed on first sight and stamped processed_at once the
 * handler succeeds:
 *
 *   new id                  claim it, run the handler, stamp processed_at
 *   id with processed_at    a duplicate delivery: skip, answer 200
 *   id without processed_at an earlier delivery failed: run the handler again
 *   handler throws          record the error, rethrow so the route answers 500
 *                           and Stripe redelivers
 *
 * Two deliveries of one unprocessed event can race and both run the handler,
 * which is why every handler has to be safe to repeat.
 *
 * `db` is a Supabase service-role client, passed in so this stays testable.
 */
import { handleStripeEvent } from "./webhookHandlers.js";

const UNIQUE_VIOLATION = "23505";

async function claimEvent(db, event) {
  const { error } = await db.from("stripe_webhook_events").insert({
    stripe_event_id: event.id,
    type: event.type,
    livemode: !!event.livemode,
  });
  if (!error) return { duplicate: false };
  if (error.code !== UNIQUE_VIOLATION) throw error;

  const { data, error: readError } = await db
    .from("stripe_webhook_events")
    .select("processed_at")
    .eq("stripe_event_id", event.id)
    .single();
  if (readError) throw readError;
  return { duplicate: !!data.processed_at };
}

export async function processStripeEvent(db, event) {
  const { duplicate } = await claimEvent(db, event);
  if (duplicate) return { status: "duplicate" };

  try {
    const result = await handleStripeEvent(event, { db });
    const { error } = await db
      .from("stripe_webhook_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("stripe_event_id", event.id);
    if (error) throw error;
    return { status: result.handled ? "handled" : "ignored" };
  } catch (err) {
    // Best effort: the original failure is the one worth surfacing.
    await db
      .from("stripe_webhook_events")
      .update({ error: String(err?.message || err).slice(0, 500) })
      .eq("stripe_event_id", event.id);
    throw err;
  }
}
