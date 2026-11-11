export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { checkListingGate, gateResponseBody } from "@/lib/billing/listingGate";
import { PublishError, draftsAmong, publishAll, publishLease, publishProperties, publishProperty, publishTargets, publishUnit } from "@/lib/listings/publish";

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
 *   properties  Several draft properties at once (ids), from the import
 *             workspace's Publish all: one request, so the agreement check
 *             asks for one signature covering all of them. Properties with
 *             no priced offering yet are skipped and stay drafts.
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
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const isSuper = session.user.role === "super";

  const body = (await req.json().catch(() => null)) ?? {};
  const { kind, id, scope } = body;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x) => typeof x === "string" && UUID.test(x)))].slice(0, 100) : [];
  const valid =
    kind === "all"
      ? ["new", "live"].includes(scope)
      : kind === "properties"
      ? ids.length > 0
      : ["property", "unit", "lease"].includes(kind) && typeof id === "string";
  if (!valid) {
    return NextResponse.json({ error: "Say what to publish." }, { status: 400 });
  }

  // Nothing in the list is ready: say so rather than asking for a signature.
  if (kind === "properties") {
    const { ready, drafts } = await draftsAmong(userId, ids);
    if (!ready.length) return NextResponse.json({ published: { kind, published: 0, skipped: drafts.length } });
  }

  // Publishing needs a payment method and, when required, a signed agreement
  // (lib/billing/listingGate.js). Drafts stay saved; only going live is refused.
  const gate = await checkListingGate(supabase, userId, { listingIds: await publishTargets(userId, kind, id, scope, ids) });
  if (!gate.allowed) return NextResponse.json(gateResponseBody(gate), { status: 403 });

  try {
    if (kind === "all") {
      const result = await publishAll(userId, isSuper, scope);
      return NextResponse.json({ published: { kind, scope, ...result } });
    }
    if (kind === "properties") {
      const result = await publishProperties(userId, isSuper, ids);
      return NextResponse.json({ published: { kind, ...result } });
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
