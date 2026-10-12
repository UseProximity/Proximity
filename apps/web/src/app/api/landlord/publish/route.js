export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isPropertyOwner, canManageLease } from "@/lib/listings/ownership";

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

async function publishProperty(userId, isSuper, id) {
  const { data: listing } = await supabase
    .from("listings")
    .select("id, published_at, deleted_at, listing_units(id, published_at, deleted_at, unit_leases(owner_id, deleted_at))")
    .eq("id", id)
    .maybeSingle();
  if (!listing || listing.deleted_at) throw new PublishError(404, "That property no longer exists.");
  if (!isSuper && !(await isPropertyOwner(userId, id))) {
    throw new PublishError(403, "Only the property's owner can publish it.");
  }
  const wasDraft = listing.published_at === null;
  const ownerIds = await ownerIdsFor(userId, isSuper, id);
  const units = liveRows(listing.listing_units);
  const draftUnitIds = units
    .filter((u) => u.published_at === null && (wasDraft || !addedByOthers(u, ownerIds)))
    .map((u) => u.id);

  await publishRows("unit_leases", "unit_id", units.map((u) => u.id), (q) =>
    wasDraft ? q : q.in("owner_id", ownerIds)
  );
  await publishRows("listing_units", "id", draftUnitIds);
  if (wasDraft) await publishRows("listings", "id", [id]);
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
    if (kind === "property") await publishProperty(userId, isSuper, id);
    else if (kind === "unit") await publishUnit(userId, isSuper, id);
    else await publishLease(userId, isSuper, id);
    return NextResponse.json({ published: { kind, id } });
  } catch (e) {
    if (e instanceof PublishError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[publish] failed:", e?.message);
    return NextResponse.json({ error: "Could not publish that. Please try again." }, { status: 500 });
  }
}
