export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireImporter } from "../_auth";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { applyEvents, rejectEvents } from "@/lib/sourceImport/apply";

/*
 * Accept or dismiss proposed changes on a listing the caller owns. Events
 * change units and lease prices across the whole listing, so only the
 * property owner (or the team) decides them; a lease-only co-owner does not
 * (PR #365 review).
 * Body: { listingId, apply: [eventId], reject: [eventId] }
 * @auth landlord
 */
export async function POST(req) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const body = await req.json().catch(() => ({}));
  const listingId = typeof body.listingId === "string" ? body.listingId : null;
  if (!listingId) return NextResponse.json({ error: "Say which listing." }, { status: 400 });
  if (!gate.isSuper && !(await isPropertyOwner(gate.userId, listingId))) {
    return NextResponse.json({ error: "Only the property owner can accept or dismiss these changes." }, { status: 403 });
  }
  const ids = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, 200) : []);
  const results = ids(body.apply).length ? await applyEvents({ listingId, eventIds: ids(body.apply), userId: gate.userId, verdictBy: gate.userId }) : [];
  if (ids(body.reject).length) await rejectEvents({ listingId, eventIds: ids(body.reject), verdictBy: gate.userId });
  return NextResponse.json({ results });
}
