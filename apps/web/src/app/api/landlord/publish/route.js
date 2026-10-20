export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner, canManageLease } from "@/lib/listings/ownership";
import { emailNewListingToOwners } from "@/lib/email/newListingEmail";
import { nextUnitSortOrder } from "@/lib/listings/unitNames";
import { unitNameKey } from "@/utils/unitName";

/*
 * Publish a draft: put a property, a unit or an offering in front of students.
 *
 * Drafts live at three levels (202610100002) and a row is public only when it
 * and everything above it are published. So publishing does what the landlord
 * means rather than flipping one flag:
 *
 *   property  A draft property goes live with everything under it. A live
 *             property publishes the caller's own additions: their draft
 *             offerings, and the draft units that are theirs (units with no
 *             offering yet, or one of the caller's). A unit another landlord
 *             added stays a draft until that landlord publishes their offering,
 *             so nobody's price goes public before they finished it.
 *   unit      Publishes the unit and the caller's draft offerings on it.
 *   lease     Publishes the offering, and its unit if that is still a draft.
 *   all       Bulk, from the Drafts page. scope "new" publishes the caller's
 *             draft properties that are complete (a unit with a priced
 *             offering). scope "live" publishes everything the caller has
 *             waiting on live properties, their own or someone else's.
 *
 * Children are written before parents, so a failure part way never reveals a
 * parent without the things the landlord expected to go with it.
 *
 * A unit or offering inside a draft property is refused rather than published
 * on its own: it would be invisible anyway, and saying so beats a button that
 * appears to work. There is no unpublish. Once live, hiding an offering is
 * Withdraw, and the database refuses to clear published_at.
 *
 * @auth user
 */
const now = () => new Date().toISOString();

class PublishError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function publishRows(table, column, ids, extra) {
  if (!ids.length) return;
  let q = supabase.from(table).update({ published_at: now() }).in(column, ids).is("published_at", null);
  if (extra) q = extra(q);
  const { error } = await q;
  if (error) throw error;
}

const liveRows = (rows) => (rows ?? []).filter((r) => !r.deleted_at);

// Complete enough to go live in bulk: some unit carries an offering with a rent.
function hasPricedLease(units) {
  return liveRows(units).some((u) => liveRows(u.unit_leases).some((l) => Number(l.rent) > 0));
}

// A draft unit added alongside someone else's offering is theirs to publish.
const addedByOthers = (unit, ownerIds) => {
  const leases = liveRows(unit.unit_leases);
  return leases.length > 0 && !leases.some((l) => ownerIds.includes(l.owner_id));
};

// Whose offerings count as the caller's own. A super acting on a property
// stands in for its owners.
async function ownerIdsFor(userId, isSuper, listingId) {
  if (!isSuper) return [userId];
  const { data } = await supabase.from("listing_landlords").select("user_id").eq("listing_id", listingId);
  return (data ?? []).map((r) => r.user_id);
}

const STILL_DRAFT = "This property is still a draft. Publish the property to put it live.";

/*
 * A draft building at an address that is already live.
 *
 * Another landlord cannot see a draft, so if they list the same building
 * while it sits in Drafts they create their own row, and publishing the draft
 * as it stands would put two copies of one building in front of students.
 * Instead the draft's units and offerings join the live building (Wyatt,
 * 2026-10-16): a unit with a name the live building already uses lends its
 * offerings and photos to that unit and is retired; any other unit moves
 * across whole, after the units already there. The draft row is then retired.
 * Property photos with no unit on them stay with it: the building's gallery is
 * its owner's, and the draft's owner is now a lease-holder there, not an
 * owner, exactly as if they had added their apartments to it by hand.
 *
 * Returns the live building's id and the unit ids now carrying the draft's
 * offerings, so the caller can publish them.
 */
async function mergeDraftIntoLive(draft, live) {
  const draftUnits = liveRows(draft.listing_units);
  const { data: liveUnitRows } = await supabase
    .from("listing_units")
    .select("id, name")
    .eq("listing_id", live.id)
    .is("deleted_at", null);
  const liveByName = new Map(
    (liveUnitRows ?? []).filter((u) => unitNameKey(u.name)).map((u) => [unitNameKey(u.name), u.id])
  );

  // Where each draft unit's offerings and photos end up.
  const target = new Map();
  const moving = [];
  for (const u of draftUnits) {
    const twin = unitNameKey(u.name) ? liveByName.get(unitNameKey(u.name)) : null;
    target.set(u.id, twin ?? u.id);
    if (!twin) moving.push(u.id);
  }

  // Whole units move first, so everything that points at them is consistent
  // by the time the photo triggers look.
  let sortOrder = await nextUnitSortOrder(live.id);
  for (const unitId of moving) {
    const { error } = await supabase
      .from("listing_units")
      .update({ listing_id: live.id, sort_order: sortOrder++ })
      .eq("id", unitId);
    if (error) throw error;
  }

  // Photos tagged with a draft unit follow it. A photo is one row with its
  // tags beside it, and both must agree with the unit's building.
  const { data: tagged } = await supabase
    .from("listing_image_units")
    .select("image_id, unit_id")
    .in("unit_id", [...target.keys()]);
  const imageIds = [...new Set((tagged ?? []).map((t) => t.image_id))];
  if (imageIds.length) {
    const { data: images } = await supabase
      .from("listing_images")
      .select("id, unit_id")
      .in("id", imageIds);
    for (const img of images ?? []) {
      const { error } = await supabase
        .from("listing_images")
        .update({ listing_id: live.id, unit_id: img.unit_id ? target.get(img.unit_id) ?? img.unit_id : null })
        .eq("id", img.id);
      if (error) throw error;
    }
  }

  // Twins: retag, move the offerings, retire the draft unit.
  for (const [draftUnitId, targetId] of target) {
    if (targetId === draftUnitId) continue;
    const { error: tagErr } = await supabase
      .from("listing_image_units")
      .update({ unit_id: targetId })
      .eq("unit_id", draftUnitId);
    if (tagErr) throw tagErr;
    const { error: leaseErr } = await supabase
      .from("unit_leases")
      .update({ unit_id: targetId })
      .eq("unit_id", draftUnitId);
    if (leaseErr) throw leaseErr;
    const { error: unitErr } = await supabase
      .from("listing_units")
      .update({ deleted_at: now() })
      .eq("id", draftUnitId);
    if (unitErr) throw unitErr;
  }

  const { error } = await supabase.from("listings").update({ deleted_at: now() }).eq("id", draft.id);
  if (error) throw error;

  return { liveId: live.id, unitIds: [...new Set(target.values())] };
}

// The live building already at this draft's address, if there is one.
async function liveTwinOf(draft) {
  if (!draft.property_key) return null;
  const { data } = await supabase
    .from("listings")
    .select("id")
    .eq("property_key", draft.property_key)
    .neq("id", draft.id)
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);
  return data?.[0] ?? null;
}

async function publishProperty(userId, isSuper, id) {
  const { data: listing } = await supabase
    .from("listings")
    .select("id, property_key, published_at, deleted_at, listing_units(id, name, published_at, deleted_at, unit_leases(id, owner_id, deleted_at))")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.deleted_at) throw new PublishError(404, "That property no longer exists.");
  if (!isSuper && !(await isPropertyOwner(userId, id))) {
    throw new PublishError(403, "Only the property's owner can publish it.");
  }
  const wasDraft = listing.published_at === null;
  const ownerIds = await ownerIdsFor(userId, isSuper, id);
  const units = liveRows(listing.listing_units);

  if (wasDraft) {
    const twin = await liveTwinOf(listing);
    if (twin) {
      // The draft's offerings are the only ones on its units, so publishing by
      // lease id puts up exactly what came across and nothing of the twin's.
      const leaseIds = units.flatMap((u) => liveRows(u.unit_leases).map((l) => l.id));
      const { liveId, unitIds } = await mergeDraftIntoLive(listing, twin);
      await publishRows("unit_leases", "id", leaseIds);
      await publishRows("listing_units", "id", unitIds);
      return { mergedInto: liveId };
    }
  }

  const draftUnitIds = units
    .filter((u) => u.published_at === null && (wasDraft || !addedByOthers(u, ownerIds)))
    .map((u) => u.id);

  await publishRows("unit_leases", "unit_id", units.map((u) => u.id), (q) =>
    wasDraft ? q : q.in("owner_id", ownerIds)
  );
  await publishRows("listing_units", "id", draftUnitIds);
  if (wasDraft) {
    await publishRows("listings", "id", [id]);
    // The "new listing" note a published-at-once property gets from addListing.
    // A draft earns it now, the first time students can see it.
    await emailNewListingToOwners(supabase, id);
  }
  return {};
}

async function canPublishUnit(userId, isSuper, unit) {
  if (isSuper) return true;
  if (await isPropertyOwner(userId, unit.listing_id)) return true;
  // Whoever is letting the unit added it to someone else's building, so it is
  // theirs to put live alongside their offering.
  return liveRows(unit.unit_leases).some((l) => l.owner_id === userId);
}

async function publishUnit(userId, isSuper, id) {
  const { data: unit } = await supabase
    .from("listing_units")
    .select("id, listing_id, published_at, deleted_at, listings!listing_id(published_at), unit_leases(owner_id, deleted_at)")
    .eq("id", id)
    .maybeSingle();
  if (!unit || unit.deleted_at) throw new PublishError(404, "That unit no longer exists.");
  if (!(await canPublishUnit(userId, isSuper, unit))) {
    throw new PublishError(403, "You can't publish this unit.");
  }
  if (unit.listings?.published_at === null) throw new PublishError(409, STILL_DRAFT);
  const ownerIds = await ownerIdsFor(userId, isSuper, unit.listing_id);
  if (addedByOthers(unit, ownerIds)) {
    throw new PublishError(409, "Another landlord added this unit. It goes live when they publish their listing.");
  }
  await publishRows("unit_leases", "unit_id", [id], (q) => q.in("owner_id", ownerIds));
  await publishRows("listing_units", "id", [id]);
}

async function publishLease(userId, isSuper, id) {
  const access = await canManageLease(userId, id);
  if (!access.ok && !(isSuper && access.reason === "forbidden")) {
    const status = access.reason === "not_found" ? 404 : access.reason === "forbidden" ? 403 : 400;
    throw new PublishError(status, "You can't publish this listing.");
  }
  const { data: lease } = await supabase
    .from("unit_leases")
    .select("listing_units!unit_id(id, published_at, deleted_at, listings!listing_id(published_at))")
    .eq("id", id)
    .maybeSingle();
  const unit = lease?.listing_units;
  if (!unit || unit.deleted_at) throw new PublishError(404, "That unit no longer exists.");
  if (unit.listings?.published_at === null) throw new PublishError(409, STILL_DRAFT);
  await publishRows("unit_leases", "id", [id]);
  if (unit.published_at === null) await publishRows("listing_units", "id", [unit.id]);
}

/*
 * Bulk publish for the Drafts page. Always scoped to what the caller owns,
 * including for a super: "publish all" never reaches across other accounts.
 */
async function publishAll(userId, isSuper, scope) {
  const { data: owned } = await supabase
    .from("listing_landlords")
    .select("listings!listing_id(id, published_at, deleted_at, listing_units(id, deleted_at, unit_leases(rent, deleted_at)))")
    .eq("user_id", userId);
  const properties = (owned ?? []).map((r) => r.listings).filter((l) => l && !l.deleted_at);

  if (scope === "new") {
    const drafts = properties.filter((l) => l.published_at === null);
    const ready = drafts.filter((l) => hasPricedLease(l.listing_units));
    for (const l of ready) await publishProperty(userId, isSuper, l.id);
    return { published: ready.length, skipped: drafts.length - ready.length };
  }

  // scope "live": the caller's draft offerings anywhere live (each brings its
  // draft unit along), then the caller's own live properties.
  const { data: myDrafts } = await supabase
    .from("unit_leases")
    .select("id, listing_units!unit_id(deleted_at, listings!listing_id(published_at, deleted_at))")
    .eq("owner_id", userId)
    .is("published_at", null)
    .is("deleted_at", null);
  const leaseIds = (myDrafts ?? [])
    .filter((l) => {
      const u = l.listing_units;
      return u && !u.deleted_at && u.listings && !u.listings.deleted_at && u.listings.published_at !== null;
    })
    .map((l) => l.id);
  for (const id of leaseIds) await publishLease(userId, isSuper, id);

  const live = properties.filter((l) => l.published_at !== null);
  for (const l of live) await publishProperty(userId, isSuper, l.id);
  return { published: leaseIds.length, properties: live.length };
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const isSuper = session.user.role === "super";

  const body = (await req.json().catch(() => null)) ?? {};
  const { kind, id, scope } = body;
  const valid =
    kind === "all"
      ? ["new", "live"].includes(scope)
      : ["property", "unit", "lease"].includes(kind) && typeof id === "string";
  if (!valid) {
    return NextResponse.json({ error: "Say what to publish." }, { status: 400 });
  }

  try {
    if (kind === "all") {
      const result = await publishAll(userId, isSuper, scope);
      return NextResponse.json({ published: { kind, scope, ...result } });
    }
    let extra = {};
    if (kind === "property") extra = await publishProperty(userId, isSuper, id);
    else if (kind === "unit") await publishUnit(userId, isSuper, id);
    else await publishLease(userId, isSuper, id);
    return NextResponse.json({ published: { kind, id, ...extra } });
  } catch (e) {
    if (e instanceof PublishError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[publish] failed:", e?.message);
    return NextResponse.json({ error: "Could not publish that. Please try again." }, { status: 500 });
  }
}
