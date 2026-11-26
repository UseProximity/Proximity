/*
 * Billing switches kept in billing_settings (key/value). A missing key reads as
 * its default, so a new switch needs no migration.
 *
 *   billing_run_enabled   whether the monthly cron may create real invoices.
 *                         Off by default, so the first real run only happens after
 *                         an admin has checked a dry run (the PRD's go-live step)
 *                         and switched it on.
 *   agreement_required    whether a signed agreement is needed to list (seeded false).
 */

import { BillingError } from "./errors.js";

export const BILLING_RUN_ENABLED = "billing_run_enabled";

/*
 * A missing key reads as `fallback`, and so does a missing table: code that reads
 * a switch (the listing gate above all, on every publish) must keep working if it
 * reaches an environment before the billing migration does. Every switch defaults
 * to its safe, off position.
 */
export async function getBillingSetting(db, key, fallback = false) {
  const { data, error } = await db.from("billing_settings").select("value").eq("key", key).maybeSingle();
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return fallback;
  if (error) throw error;
  return data ? data.value : fallback;
}

export async function setBillingSetting(db, key, value, adminId = null) {
  const { error } = await db
    .from("billing_settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: adminId }, { onConflict: "key" });
  if (error) throw error;
}

/*
 * Run `fn` while holding a lock that only one caller at a time can hold, across
 * every server instance. The lock is a billing_settings row under `key`: inserting
 * it succeeds for exactly one caller (the key is the primary key). A lock older
 * than `staleMs` belongs to a caller that died and is taken over. Anyone else gets
 * a 409 with `busyMessage`.
 */
export async function withSettingsLock(db, { key, staleMs, busyMessage, now = new Date() }, fn) {
  const value = { started_at: now.toISOString() };
  const busy = () => new BillingError("in_progress", busyMessage, 409);
  const take = () => db.from("billing_settings").insert({ key, value });
  let { error } = await take();
  if (error?.code === "23505") {
    const { data: held, error: readError } = await db.from("billing_settings").select("value").eq("key", key).maybeSingle();
    if (readError) throw readError;
    const startedAt = new Date(held?.value?.started_at ?? 0).getTime();
    if (held && now.getTime() - startedAt < staleMs) throw busy();
    // Stale: clear exactly that lock (not one another caller has just taken) and try once more.
    await db.from("billing_settings").delete().eq("key", key).eq("value->>started_at", held?.value?.started_at ?? "");
    ({ error } = await take());
    if (error?.code === "23505") throw busy();
  }
  if (error) throw error;
  try {
    return await fn();
  } finally {
    const { error: releaseError } = await db.from("billing_settings").delete().eq("key", key).eq("value->>started_at", value.started_at);
    if (releaseError) console.error(`billing: could not release the lock ${key}`, releaseError.message);
  }
}
