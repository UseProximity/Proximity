/*
 * Who went to apply (listing_applications), server side.
 *
 * We cannot see inside a landlord's portal, so tracking is two steps:
 *   1. Apply clicked: the student is recorded as "started" (repeats bump
 *      click_count and last_clicked_at on the same row).
 *   2. On their next visit to the listing they are asked "Did you submit
 *      your application?" and their answer moves the row to "applied" or
 *      "not_applying".
 * One row per student per application link on a listing, so a listing whose
 * landlords use different portals keeps them apart.
 *
 * The link recorded is always read from the lease, never taken from the
 * browser, so nobody can log an arbitrary URL against a listing.
 */
import supabase from "@/lib/supabase";
import { isLiveLease } from "@/lib/listings/unitAvailability";

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

  const now = new Date().toISOString();
  const find = () => supabase.from("listing_applications").select(ROW)
    .eq("listing_id", listingId).eq("student_id", studentId).eq("application_url", lease.application_url)
    .maybeSingle();

  const bump = async (row) => {
    const { data, error } = await supabase.from("listing_applications")
      .update({ click_count: (row.click_count ?? 0) + 1, last_clicked_at: now, lease_id: lease.id, landlord_id: lease.owner_id ?? null, updated_at: now })
      .eq("id", row.id).select(ROW).single();
    if (error) throw new Error(`application bump: ${error.message}`);
    return { application: shape(data) };
  };

  const { data: existing, error: findErr } = await find();
  if (findErr) throw new Error(`application find: ${findErr.message}`);
  if (existing) return bump(existing);

  const { data, error } = await supabase.from("listing_applications").insert({
    listing_id: listingId, student_id: studentId, landlord_id: lease.owner_id ?? null,
    lease_id: lease.id, application_url: lease.application_url,
  }).select(ROW).single();
  if (error) {
    // A double click raced the insert: count it on the row that won.
    if (error.code === "23505") {
      const { data: again } = await find();
      if (again) return bump(again);
    }
    throw new Error(`application insert: ${error.message}`);
  }
  return { application: shape(data) };
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
 * What a landlord sees for one property: how many students went to their
 * application and how many said they submitted it, plus who those submitters
 * are. Students who only clicked stay anonymous, the same way Proxy keeps
 * identities screened until a tour: a click is not an application. Someone
 * who says they applied has already given the landlord their details.
 */
export async function landlordApplications({ landlordId, listingId }) {
  const { data, error } = await supabase
    .from("listing_applications")
    .select("id, status, first_clicked_at, last_clicked_at, answered_at, users!student_id(name, email)")
    .eq("listing_id", listingId)
    .eq("landlord_id", landlordId)
    .order("answered_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`landlord applications: ${error.message}`);
  const rows = data ?? [];
  return {
    started: rows.length,
    applied: rows.filter((r) => r.status === "applied").length,
    applicants: rows
      .filter((r) => r.status === "applied")
      .map((r) => ({ id: r.id, name: r.users?.name ?? null, email: r.users?.email ?? null, appliedAt: r.answered_at })),
  };
}
