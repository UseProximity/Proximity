/*
 * POST /api/landlord/listings/[listingId]/agent/url  { url }
 *
 * Add a website to a live listing's agent. The same full read as a new
 * import runs in the background; displayed-field differences wait as
 * proposed changes for the landlord to confirm, and the pages' fees,
 * policies and specials go into the listing's knowledge.
 *
 * Only the primary owner (or a super) can add the property's source URL.
 *
 * @auth landlord
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPropertyOwner } from "@/lib/listings/ownership";
import { addUrl } from "@/lib/agents/sync";

export async function POST(req, { params }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { listingId } = await params;
  const isAdmin = ["super", "admin"].includes(session.user.role);
  if (!isAdmin && !(await isPropertyOwner(session.user.id, listingId))) {
    return NextResponse.json({ error: "Only the property's primary owner can add its website." }, { status: 403 });
  }
  try {
    let body;
    try { body = await req.json(); } catch { body = {}; }
    const url = String(body?.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Enter a full web address starting with http." }, { status: 400 });
    const r = await addUrl({ listingId, url, userId: session.user.id });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
    return NextResponse.json({ ok: true, job: r.job });
  } catch (err) {
    console.error("POST agent/url failed:", err);
    return NextResponse.json({ error: "Could not add that website" }, { status: 500 });
  }
}
