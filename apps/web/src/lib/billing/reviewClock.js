/*
 * The review clock. A confirmed charge sits in Pending for 7 days, counted from
 * when it entered Pending (not when it was created). When the time is up it is
 * approved automatically, unless the landlord or an admin already acted on it.
 *
 * Run daily by /api/cron/billing-review-clock. Safe to run any number of times,
 * and safe against a landlord approving at the same moment: each approval is a
 * compare-and-swap on the status, so whoever loses gets "status changed" and is
 * counted as skipped, never as an error.
 *
 * `db` is a service-role Supabase client, passed in so this stays testable.
 */
import { REVIEW_DAYS, DAY_MS } from "./constants.js";
import { transitionCharge } from "./charges.js";

const BATCH = 200;
const MAX_BATCHES = 10;

export async function runReviewClock(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - REVIEW_DAYS * DAY_MS).toISOString();
  const result = { due: 0, approved: 0, skipped: 0, failed: [] };
  const seen = new Set();

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const { data, error } = await db
      .from("charges")
      .select("id")
      .eq("status", "pending")
      .lte("pending_at", cutoff)
      .order("pending_at", { ascending: true })
      .limit(BATCH);
    if (error) throw error;

    // Anything we already tried this run (a failure that stays pending) is not retried in a loop.
    const todo = data.filter((c) => !seen.has(c.id));
    if (!todo.length) break;

    for (const { id } of todo) {
      seen.add(id);
      result.due += 1;
      try {
        await transitionCharge(db, { chargeId: id, expectedFrom: "pending", to: "approved", actorType: "system" });
        result.approved += 1;
      } catch (err) {
        if (err?.code === "status_changed") result.skipped += 1;
        else result.failed.push({ id, error: String(err?.message ?? err).slice(0, 200) });
      }
    }
    if (data.length < BATCH) break;
  }
  return result;
}
