/*
 * The overdue job: an invoice unpaid for more than 30 days after its due date
 * (older invoices: after their invoice date) withdraws the landlord's leases
 * (hides them from students). The landlord and the team are emailed once.
 *
 * The clock (see overdue.js) needs the dates Stripe's finalize sets: a row a
 * crashed run left before that has no date and is never actioned. So Approved charges
 * under the $5 minimum, which can wait months without an invoice, never trigger
 * it. A payment still settling (Processing) does not count as overdue.
 *
 * Withdrawing is the same edit a landlord makes by hand (unit_leases is_active
 * false and unavailable true), applied to leases that are live right now. Each
 * one is recorded in billing_lease_withdrawals so restoring puts back exactly
 * what billing took down, and leaves alone any lease the landlord had withdrawn
 * themselves. An admin restores them once the invoice is paid.
 *
 * Safe to run any number of times: the order is withdraw and record, then stamp
 * the invoice, then email, and only the run that stamps the invoice emails.
 *
 * `db` is a service-role Supabase client. `notify` ({ overdue }) sends the emails.
 */
import { isInvoiceOverdue, overdueCutoff } from "./overdue.js";

const BATCH = 200;

// Leases that are on the market right now: published, active, available and not deleted.
async function liveLeaseIds(db, landlordId) {
  const { data, error } = await db
    .from("unit_leases")
    .select("id")
    .eq("owner_id", landlordId)
    .eq("is_active", true)
    .eq("unavailable", false)
    .is("deleted_at", null)
    .not("published_at", "is", null);
  if (error) throw error;
  return data.map((l) => l.id);
}

async function withdrawLeases(db, invoiceId, landlordId) {
  const ids = await liveLeaseIds(db, landlordId);
  if (ids.length) {
    // Record first: if the update then fails, the lease is merely listed as ours, never lost.
    const { error: recordError } = await db
      .from("billing_lease_withdrawals")
      .upsert(ids.map((lease_id) => ({ invoice_id: invoiceId, lease_id })), { onConflict: "invoice_id,lease_id", ignoreDuplicates: true });
    if (recordError) throw recordError;
    const { error } = await db.from("unit_leases").update({ is_active: false, unavailable: true }).in("id", ids);
    if (error) throw error;
  }
  return ids.length;
}

export async function runOverdueJob(db, { now = new Date(), notify = {} } = {}) {
  const cutoff = overdueCutoff(now).toISOString();
  const result = { checked: 0, actioned: 0, leasesWithdrawn: 0, failed: [] };

  const { data: invoices, error } = await db
    .from("billing_invoices")
    .select("id, landlord_id, status, total_cents, invoice_date, due_date, overdue_actioned_at")
    .in("status", ["open", "failed"])
    .is("overdue_actioned_at", null)
    .not("stripe_invoice_id", "is", null)
    // Past the cutoff by due date, or by invoice date for invoices without one.
    .or(`due_date.lt.${cutoff},and(due_date.is.null,invoice_date.lt.${cutoff})`)
    .order("invoice_date", { ascending: true })
    .limit(BATCH);
  if (error) throw error;

  for (const invoice of invoices) {
    if (!isInvoiceOverdue(invoice, now)) continue;
    result.checked += 1;
    try {
      const withdrawn = await withdrawLeases(db, invoice.id, invoice.landlord_id);

      // Only the run that stamps the invoice announces it.
      const { data: stamped, error: stampError } = await db
        .from("billing_invoices")
        .update({ overdue_actioned_at: now.toISOString() })
        .eq("id", invoice.id)
        .is("overdue_actioned_at", null)
        .select("id")
        .maybeSingle();
      if (stampError) throw stampError;
      if (!stamped) continue;

      result.actioned += 1;
      result.leasesWithdrawn += withdrawn;
      if (notify.overdue) {
        const { data: landlord } = await db.from("users").select("id, name, email").eq("id", invoice.landlord_id).maybeSingle();
        try {
          await notify.overdue({ invoice, landlord, withdrawnCount: withdrawn });
        } catch (err) {
          console.error("billing: overdue email failed", err?.message);
        }
      }
    } catch (err) {
      result.failed.push({ invoiceId: invoice.id, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return result;
}

/*
 * Put back the leases the overdue job withdrew for an invoice. Only a lease still
 * in the withdrawn state is touched: one the landlord has since republished,
 * changed or deleted is left exactly as it is. Each is marked restored either way.
 */
export async function restoreWithdrawnLeases(db, { invoiceId, adminId, now = new Date() }) {
  const { data: rows, error } = await db
    .from("billing_lease_withdrawals")
    .select("id, lease_id")
    .eq("invoice_id", invoiceId)
    .is("restored_at", null);
  if (error) throw error;

  let restored = 0;
  for (const row of rows) {
    // Marked restored first: the database refuses to put a lease back on the market
    // while an unrestored withdrawal points at it (202611010002_billing_holds.sql).
    const { error: markError } = await db
      .from("billing_lease_withdrawals")
      .update({ restored_at: now.toISOString(), restored_by_id: adminId })
      .eq("id", row.id);
    if (markError) throw markError;
    const { data: lease, error: updateError } = await db
      .from("unit_leases")
      .update({ is_active: true, unavailable: false })
      .eq("id", row.lease_id)
      .eq("is_active", false)
      .eq("unavailable", true)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (updateError) {
      // Leave it listed as withdrawn so the admin can try again.
      await db.from("billing_lease_withdrawals").update({ restored_at: null, restored_by_id: null }).eq("id", row.id);
      throw updateError;
    }
    if (lease) restored += 1;
  }
  return { restored, total: rows.length };
}
