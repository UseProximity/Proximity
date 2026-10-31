export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { requireImporter } from "../_auth";
import { getOwnedListings } from "@/lib/listings/ownership";
import { applyEvents, rejectEvents } from "@/lib/sourceImport/apply";

/*
 * Accept or dismiss proposed changes on a listing the caller owns.
 * Body: { listingId, apply: [eventId], reject: [eventId] }
 * @auth landlord
 */
export async function POST(req) {
  const gate = await requireImporter();
  if (gate.res) return gate.res;
  const body = await req.json().catch(() => ({}));
  const listingId = typeof body.listingId === "string" ? body.listingId : null;
  if (!listingId) return NextResponse.json({ error: "Say which listing." }, { status: 400 });
  const owned = await getOwnedListings(gate.userId);
  if (!gate.isSuper && !owned.has(listingId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const ids = (arr) => (Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, 200) : []);
  const results = ids(body.apply).length ? await applyEvents({ listingId, eventIds: ids(body.apply), userId: gate.userId, verdictBy: gate.userId }) : [];
  if (ids(body.reject).length) await rejectEvents({ listingId, eventIds: ids(body.reject), verdictBy: gate.userId });
  return NextResponse.json({ results });
}
