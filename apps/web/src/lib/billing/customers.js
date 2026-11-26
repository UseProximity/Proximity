/*
 * Each landlord user gets exactly one Stripe Customer, created the first time
 * they need one (opening payment setup), not at signup.
 *
 * Creating the customer is idempotent on Stripe's side (the key is the user id),
 * and billing_accounts.user_id is unique, so two requests racing to create it
 * end up with one customer and one row. `db` is a service-role Supabase client
 * and `stripe` a Stripe client, both passed in so this stays testable.
 */

export async function getOrCreateBillingAccount(db, stripe, user) {
  const { data: existing, error: readError } = await db
    .from("billing_accounts")
    .select("id, user_id, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing?.stripe_customer_id) return existing;

  const customer = await stripe.customers.create(
    {
      email: user.email,
      name: user.name || undefined,
      metadata: { user_id: user.id },
    },
    { idempotencyKey: `customer-create:${user.id}` }
  );

  // Covers both a first creation and a row whose customer id was cleared (the
  // dev snapshot nulls it, since live ids mean nothing to a sandbox).
  const { data, error } = await db
    .from("billing_accounts")
    .upsert({ user_id: user.id, stripe_customer_id: customer.id }, { onConflict: "user_id" })
    .select("id, user_id, stripe_customer_id")
    .single();
  if (error) throw error;
  return data;
}

// The landlord a Stripe customer belongs to, or null if it is not one of ours.
export async function userIdForCustomer(db, customerId) {
  if (!customerId) return null;
  const { data, error } = await db
    .from("billing_accounts")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id ?? null;
}
