/*
 * Who went to apply (listing_applications), server side.
 *
 * We cannot see inside a landlord's portal, so tracking is two steps:
 *   1. Apply clicked: the student is recorded as "started" (repeats bump
 *      click_count and last_clicked_at on the same row, and a repeat after
 *      "I'm not applying" makes it "started" again).
 *   2. On their next visit to the listing they are asked "Did you submit
 *      your application?" and their answer moves the row to "applied" or
 *      "not_applying".
 * One row per student per landlord on a listing, so co-landlords keep their
 * own students even when they share one portal link.
 *
 * The link recorded is always read from the lease, never taken from the
 * browser, so nobody can log an arbitrary URL against a listing.
 */
import supabase from "@/lib/supabase";
import { isLiveLease } from "@/lib/listings/unitAvailability";
import { sandboxViewFor } from "@/lib/agents/sandbox";

export const APPLICATION_STATUSES = ["started", "applied", "not_applying"];

const ROW = "id, listing_id, lease_id, landlord_id, application_url, status, click_count, first_clicked_at, last_clicked_at, answered_at";

const shape = (r) => ({
  id: r.id,
  listingId: r.listing_id,
  leaseId: r.lease_id,
  status: r.status,
  clickCount: r.click_count,
  firstClickedAt: r.first_clicked_at,
  lastClickedAt: r.last_clicked_at,
  answeredAt: r.answered_at,
});

/* The live lease on this listing that carries this application link, or null. */
async function leaseWithLink(listingId, leaseId) {
  const { data, error } = await supabase
    .from("unit_leases")
    .select("id, owner_id, application_url, is_active, unavailable, deleted_at, published_at, listing_units!unit_id!inner(listing_id, deleted_at, published_at)")
    .eq("id", leaseId)
    .maybeSingle();
  if (error) throw new Error(`application lease: ${error.message}`);
  if (!data || data.listing_units?.listing_id !== listingId) return null;
  if (!data.application_url || data.deleted_at || data.listing_units?.deleted_at || !isLiveLease(data)) return null;
  return data;
}

/* The student's rows on one listing, newest click first. */
export async function studentApplications({ studentId, listingId }) {
  const { data, error } = await supabase
    .from("listing_applications")
    .select(ROW)
    .eq("student_id", studentId)
    .eq("listing_id", listingId)
    .order("last_clicked_at", { ascending: false });
  if (error) throw new Error(`applications: ${error.message}`);
  return (data ?? []).map(shape);
}

/* Apply was clicked: record it, or count the repeat on the existing row. */
export async function recordApplyClick({ studentId, listingId, leaseId }) {
  const lease = await leaseWithLink(listingId, leaseId);
  if (!lease) return { error: "This listing has no application link.", status: 404 };
  if (lease.owner_id && lease.owner_id === studentId) return { skipped: true };
  const { data: owns } = await supabase
    .from("listing_landlords").select("listing_id")
    .eq("listing_id", listingId).eq("user_id", studentId).limit(1);
  // An owner opening their own link is checking it, not applying.
  if (owns?.length) return { skipped: true };

  // One statement: insert, or count the repeat (and put "I'm not applying"
  // back to "started"). See record_application_click in
  // 202611160001_application_per_landlord.sql.
  const { data, error } = await supabase.rpc("record_application_click", {
    p_listing_id: listingId,
    p_student_id: studentId,
    p_landlord_id: lease.owner_id ?? null,
    p_lease_id: lease.id,
    p_application_url: lease.application_url,
  });
  if (error) throw new Error(`application click: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("application click: no row returned");
  return { application: shape(row) };
}

/* The student's answer to "Did you submit your application?". */
export async function answerApplication({ studentId, applicationId, status }) {
  if (!APPLICATION_STATUSES.includes(status) || status === "started") {
    return { error: "That answer isn't one we know.", status: 400 };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("listing_applications")
    .update({ status, answered_at: now, updated_at: now })
    .eq("id", applicationId).eq("student_id", studentId)
    .select(ROW).maybeSingle();
  if (error) throw new Error(`application answer: ${error.message}`);
  if (!data) return { error: "Application not found.", status: 404 };
  return { application: shape(data) };
}

/*
 * What a landlord sees for one property (Wyatt, 2026-11-16): how many
 * students clicked Apply on their link, and by name only those who told us
 * they submitted it. A click alone stays anonymous, since the student may
 * only have been looking at the portal.
 *
 * Hidden from a real landlord: review sandbox students (App Store reviewers,
 * lib/agents/sandbox.js) and accounts deleted or pending deletion.
 */
export async function landlordApplications({ landlordId, listingId }) {
  const [{ data, error }, view] = await Promise.all([
    supabase
      .from("listing_applications")
      .select("id, student_id, status, answered_at, users!student_id(name, email, deleted_at)")
      .eq("listing_id", listingId)
      .eq("landlord_id", landlordId),
    sandboxViewFor(landlordId),
  ]);
  if (error) throw new Error(`landlord applications: ${error.message}`);
  const rows = view.tours(data ?? [], (r) => r.student_id).filter((r) => !r.users?.deleted_at);
  const applied = rows
    .filter((r) => r.status === "applied")
    .sort((a, b) => String(b.answered_at).localeCompare(String(a.answered_at)));
  return {
    started: rows.length,
    applied: applied.length,
    applicants: applied.map((r) => ({ id: r.id, name: r.users?.name ?? null, email: r.users?.email ?? null, at: r.answered_at })),
  };
}
