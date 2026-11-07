/*
 * A landlord's outstanding balance: Approved charges not yet on an invoice, which
 * is what the next billing run would collect. Used where someone needs the
 * figure without loading every charge (the admin email when a landlord removes
 * their only payment method).
 */
export async function outstandingBalanceCents(db, landlordId) {
  const { data, error } = await db
    .from("charges")
    .select("amount_cents")
    .eq("landlord_id", landlordId)
    .eq("status", "approved")
    .is("invoice_id", null);
  if (error) throw error;
  return (data ?? []).reduce((sum, c) => sum + c.amount_cents, 0);
}
