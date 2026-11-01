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

export const BILLING_RUN_ENABLED = "billing_run_enabled";

export async function getBillingSetting(db, key, fallback = false) {
  const { data, error } = await db.from("billing_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw error;
  return data ? data.value : fallback;
}

export async function setBillingSetting(db, key, value, adminId = null) {
  const { error } = await db
    .from("billing_settings")
    .upsert({ key, value, updated_at: new Date().toISOString(), updated_by: adminId }, { onConflict: "key" });
  if (error) throw error;
}
