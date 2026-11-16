/*
 * Hand a batch of imported drafts to a landlord.
 *
 * Landlords ask the team to build their listings for them. The team runs the
 * import from a team account, checks the drafts in the workspace, and then
 * hands the whole batch over here in one step: the drafts move to the
 * landlord's account, where they sit on the Drafts page until the landlord
 * has verified and published them. Nothing is published by this.
 *
 * What moves for each draft:
 *   listing_landlords   the importer's row is replaced by the landlord's
 *   unit_leases         owner_id, for the leases the importer owns
 *   listing_images      owner_id, for the photos the importer stored
 *   contact fields      on the listing and its leases, only where they are
 *                       still the importer's (handOverRules.js contactPatch)
 *
 * Only drafts the batch created and finished are touched. A building that
 * already existed, a published listing, and a draft somebody else is on are
 * left alone and reported back with the reason.
 *
 * Not one transaction (PostgREST gives none without an RPC), so the steps are
 * ordered to be safe to repeat: the landlord's ownership row is written
 * first, so a draft is never without an owner, and a second call picks up a
 * draft that stopped half way (it reads as shared, see `resume` below).
 */
import supabase from "@/lib/supabase";
import { insertAsUser, updateAsUser, deleteAsUser } from "@/lib/supabaseWithUser";
import { contactPatch, handOverCandidates, refusal } from "./handOverRules.js";

const CONTACT = "name, email, phone";

/* The account drafts may be handed to: a live landlord, never a system row. */
export async function landlordByEmail(email) {
  const clean = String(email ?? "").trim().toLowerCase();
  if (!clean || clean.length > 320) return null;
  const { data } = await supabase
    .from("users")
    .select("id, name, email, phone, deleted_at, is_system, billing_only, roles!role_id(name)")
    .eq("email", clean)
    .maybeSingle();
  // A billing-only account pays for another landlord and has no listing tools.
  if (!data || data.deleted_at || data.is_system || data.billing_only || data.roles?.name !== "landlord") return null;
  return { id: data.id, name: data.name, email: data.email, phone: data.phone };
}

// Rows grouped by the patch they need, so a building is a few updates.
async function patchContacts(table, rows, from, to) {
  const groups = new Map();
  for (const row of rows) {
    const patch = contactPatch(row, from, to);
    if (!Object.keys(patch).length) continue;
    const key = JSON.stringify(patch);
    if (!groups.has(key)) groups.set(key, { patch, ids: [] });
    groups.get(key).ids.push(row.id);
  }
  for (const { patch, ids } of groups.values()) {
    const { error } = await supabase.from(table).update(patch).in("id", ids);
    if (error) throw new Error(`${table} contact: ${error.message}`);
  }
}

async function handOverOne({ listingId, fromId, from, to, actorId }) {
  const [{ data: listing }, { data: links, error: linkErr }] = await Promise.all([
    supabase.from("listings").select("id, title, address, published_at, deleted_at, contact_email, contact_name, contact_phone").eq("id", listingId).maybeSingle(),
    supabase.from("listing_landlords").select("user_id").eq("listing_id", listingId),
  ]);
  // A failed read is not evidence the draft is free to move.
  if (linkErr) throw new Error(`owners: ${linkErr.message}`);
  const ownerIds = (links ?? []).map((l) => l.user_id);
  const label = listing?.title ?? listing?.address ?? "Property";

  // A call that stopped after writing the landlord's row: exactly the two of
  // them on an unpublished draft. Carry on from there.
  const resume = !!listing && !listing.deleted_at && listing.published_at === null
    && ownerIds.length === 2 && ownerIds.includes(fromId) && ownerIds.includes(to.id);
  if (!resume) {
    const why = refusal({ listing, ownerIds, fromId, toId: to.id });
    if (why) return { listingId, title: label, ok: false, reason: why };
    const { error } = await insertAsUser(supabase, { userId: actorId, table: "listing_landlords", data: { listing_id: listingId, user_id: to.id, is_primary: false } });
    if (error) throw new Error(`owner: ${error.message}`);
  }
  const { error: dropErr } = await deleteAsUser(supabase, { userId: actorId, table: "listing_landlords", match: { listing_id: listingId, user_id: fromId } });
  if (dropErr) throw new Error(`owner: ${dropErr.message}`);
  const { error: primaryErr } = await updateAsUser(supabase, { userId: actorId, table: "listing_landlords", data: { is_primary: true }, match: { listing_id: listingId, user_id: to.id } });
  if (primaryErr) throw new Error(`owner: ${primaryErr.message}`);

  const { data: units } = await supabase.from("listing_units").select("id").eq("listing_id", listingId);
  const unitIds = (units ?? []).map((u) => u.id);
  if (unitIds.length) {
    const { data: leases, error: leaseErr } = await supabase
      .from("unit_leases")
      .select("id, contact_email, contact_name, contact_phone")
      .in("unit_id", unitIds)
      .eq("owner_id", fromId);
    if (leaseErr) throw new Error(`leases: ${leaseErr.message}`);
    if (leases?.length) {
      const { error } = await supabase.from("unit_leases").update({ owner_id: to.id }).in("id", leases.map((l) => l.id));
      if (error) throw new Error(`leases: ${error.message}`);
      await patchContacts("unit_leases", leases, from, to);
    }
  }
  const { error: imageErr } = await supabase.from("listing_images").update({ owner_id: to.id }).eq("listing_id", listingId).eq("owner_id", fromId);
  if (imageErr) throw new Error(`photos: ${imageErr.message}`);
  await patchContacts("listings", [listing], from, to);
  return { listingId, title: label, ok: true };
}

/*
 * Hand over every finished draft of a batch. Returns
 * { moved: [{ listingId, title }], left: [{ listingId, title, reason }] },
 * or null when the batch is not the importer's (or holds nothing to move).
 *   fromId    the account that ran the import (the batch's owner)
 *   to        the landlord, from landlordByEmail
 *   actorId   who pressed the button, for the action log
 */
export async function handOverBatch({ batchId, fromId, to, actorId }) {
  const { data: jobs, error } = await supabase
    .from("listing_import_jobs")
    .select("id, listing_id, status, target")
    .eq("batch_id", batchId)
    .eq("user_id", fromId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`batch: ${error.message}`);
  if (!jobs?.length) return null;
  const candidates = handOverCandidates(jobs);
  const { data: from } = await supabase.from("users").select(CONTACT).eq("id", fromId).maybeSingle();

  const moved = [];
  const left = [];
  for (const job of candidates) {
    try {
      const res = await handOverOne({ listingId: job.listing_id, fromId, from: from ?? {}, to, actorId });
      if (res.ok) moved.push({ listingId: res.listingId, title: res.title });
      else left.push({ listingId: res.listingId, title: res.title, reason: res.reason });
    } catch (err) {
      console.error(`[import/hand-over] ${job.listing_id}:`, err?.message);
      left.push({ listingId: job.listing_id, title: job.target?.name ?? "Property", reason: "Something went wrong moving this one. Try again." });
    }
  }
  console.log(`[import/hand-over] batch ${batchId}: ${moved.length} moved, ${left.length} left`);
  return { moved, left };
}
