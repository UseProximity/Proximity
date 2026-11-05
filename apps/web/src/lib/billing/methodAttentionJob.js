/*
 * The daily "update your payment method" check. A landlord whose default method
 * will not be able to pay the next invoice is emailed, once per problem, before
 * the monthly run fails on it:
 *
 *   expiring  a card in its last valid month (it stops working on the 1st)
 *   expired   a card past its expiry month
 *   failed    the last payment with it, or its bank verification, failed
 *
 * Nobody is emailed while they have another usable method: the billing run
 * charges that one instead (chargeableMethod), so there is nothing to fix. What
 * was emailed is stored on the method (attention_emailed_key) and cleared here
 * once the method is fine again. Before that column exists the check does nothing.
 *
 * `db` is a service-role Supabase client. `notify` ({ methodAttention }) sends the email.
 */
import { describeMethod, effectiveStatus, hasActivePaymentMethod } from "./paymentMethodState.js";

const PAGE = 1000;
const MISSING_COLUMN = new Set(["42703", "PGRST204"]);

// What, if anything, to tell the landlord about this method.
export function attentionState(method, now = new Date()) {
  const status = effectiveStatus(method, now);
  if (status === "expired" || status === "failed") return status;
  const lastMonth = method.exp_year === now.getUTCFullYear() && method.exp_month === now.getUTCMonth() + 1;
  if (status === "active" && method.type === "card" && lastMonth) return "expiring";
  return null;
}

export function attentionKey(method, state) {
  return `${state}:${method.exp_month ?? "-"}/${method.exp_year ?? "-"}`;
}

export async function runMethodAttentionJob(db, { now = new Date(), notify = {} } = {}) {
  const result = { checked: 0, emailed: 0, cleared: 0, failed: [] };
  const defaults = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("payment_methods")
      .select("id, user_id, type, status, brand, last4, exp_month, exp_year, bank_name, attention_emailed_key")
      .eq("is_default", true)
      .is("deleted_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      if (MISSING_COLUMN.has(error.code) || error.code === "PGRST205" || error.code === "42P01") return { ...result, skipped: "migration_missing" };
      throw error;
    }
    defaults.push(...data);
    if (data.length < PAGE) break;
  }

  for (const method of defaults) {
    result.checked += 1;
    try {
      const state = attentionState(method, now);
      if (!state) {
        if (method.attention_emailed_key) {
          const { error } = await db.from("payment_methods").update({ attention_emailed_key: null, attention_emailed_at: null }).eq("id", method.id);
          if (error) throw error;
          result.cleared += 1;
        }
        continue;
      }
      const key = attentionKey(method, state);
      if (method.attention_emailed_key === key) continue;

      const { data: others, error: othersError } = await db
        .from("payment_methods")
        .select("status, type, exp_month, exp_year, deleted_at")
        .eq("user_id", method.user_id)
        .neq("id", method.id)
        .is("deleted_at", null);
      if (othersError) throw othersError;
      if (hasActivePaymentMethod(others, now)) continue;

      // Claim it first, so two overlapping runs cannot both email.
      const { data: claimed, error: claimError } = await db
        .from("payment_methods")
        .update({ attention_emailed_key: key, attention_emailed_at: now.toISOString() })
        .eq("id", method.id)
        .or(`attention_emailed_key.is.null,attention_emailed_key.neq."${key}"`)
        .select("id")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      const { data: landlord, error: userError } = await db
        .from("users")
        .select("id, name, email, deleted_at")
        .eq("id", method.user_id)
        .maybeSingle();
      if (userError) throw userError;
      if (!landlord?.email || landlord.deleted_at) continue;

      if (notify.methodAttention) {
        try {
          await notify.methodAttention({ landlord, state, description: describeMethod(method) });
        } catch (err) {
          console.error("billing: payment method email failed", err?.message);
        }
      }
      result.emailed += 1;
    } catch (err) {
      result.failed.push({ methodId: method.id, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return result;
}
