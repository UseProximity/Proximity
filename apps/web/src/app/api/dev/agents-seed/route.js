/*
 * Per-listing agents: seed the dev knowledge store from the command line.
 * DEV-ONLY (403 in production). The admin route does the same thing behind
 * a login; this one exists so a curl can fill the store while building.
 *
 *   POST /api/dev/agents-seed            seed every live listing
 *   POST /api/dev/agents-seed?listingId= seed one
 *   GET  /api/dev/agents-seed            the counts
 *
 * @auth public
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { seedListing, seedAll } from "@/lib/agents/seed";
import { overview } from "@/lib/agents/overview";

const guard = () => process.env.NODE_ENV === "production";

export async function GET() {
  if (guard()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await overview());
}

export async function POST(req) {
  if (guard()) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const listingId = new URL(req.url).searchParams.get("listingId");
  const result = listingId ? await seedListing(listingId) : await seedAll();
  return NextResponse.json({ ok: true, result });
}
