export const dynamic = "force-dynamic";
// Reading a company's front page and asking which buildings it lists can take
// a while on a JS-heavy site; the per-property reads run as background jobs.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { discoverSite } from "@/lib/sourceImport/read";
import { findExistingProperties } from "@/lib/listings/propertyName";
import { getOwnedListings } from "@/lib/listings/ownership";
import { resolveProximityLandlordId } from "@/lib/listings/placeholderOwner";
import supabase from "@/lib/supabase";
import { listingDraftRateLimited } from "@/lib/listingDraft/rateLimit";

/*
 * The picker's call: what is at this URL?
 *
 * Returns { pms } to steer a PMS portal to the integration, { error } when the
 * page cannot be read, or { sourceUrl, properties, listing } where properties
 * is the list to tick (folders included) and listing, when set, means the
 * page is one property. Reading a property's units, prices and photos is NOT
 * done here any more: Continue creates a draft and a background job per
 * ticked property (POST /api/landlord/import/start).
 *
 * @auth landlord
 */
const FETCH_ERRORS = {
  bad_url: [400, "That doesn't look like a valid website address."],
  unsupported_scheme: [400, "Please paste a normal http(s) website address."],
  private_address: [400, "That address can't be used here."],
  blocked: [422, "Your website's security settings blocked our reader. You can still fill out the form manually."],
  unreachable: [422, "We couldn't reach that page. Double-check the address, or fill out the form manually."],
  no_text: [422, "We couldn't find readable listing info on that page. Try pasting your listings or availability page instead."],
  unreadable: [422, "We couldn't read that page. You can still fill out the form manually."],
  no_properties: [422, "We couldn't pick out a property from that page. Try pasting the page for one specific property."],
};

export async function POST(req) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!["landlord", "super"].includes(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!rawUrl) return NextResponse.json({ error: "Paste a website address first." }, { status: 400 });

    if (listingDraftRateLimited(session.user.id)) {
      return NextResponse.json({ error: "You've used all your website imports for now. Try again in an hour." }, { status: 429 });
    }

    const found = await discoverSite({ url: rawUrl, skipPmsSteer: body.skipPmsSteer === true });

    if (found.kind === "pms") return NextResponse.json({ pms: found.pms });
    if (found.kind === "error") {
      if (found.code === "pms_widget") return NextResponse.json({ error: found.message }, { status: 422 });
      if (found.code === "portal_gone") {
        return NextResponse.json(
          { error: `That listing is no longer live on ${found.site}. Paste the address of your own website instead, or the listing page that is currently up.` },
          { status: 422 }
        );
      }
      const [status, message] = FETCH_ERRORS[found.code] ?? FETCH_ERRORS.unreachable;
      return NextResponse.json({ error: message }, { status });
    }

    const properties = found.kind === "single" ? [found.property, ...(found.properties ?? [])] : found.properties;
    const marked = await markAlreadyListed(properties, session.user.id);
    return NextResponse.json({
      sourceUrl: found.sourceUrl,
      properties: marked,
      // The picker treats a page that is one property as a one-row list.
      listing: found.kind === "single" ? { title: found.property.name, address: found.property.address } : null,
    });
  } catch (e) {
    console.error("[listing-draft] error:", e?.message);
    return NextResponse.json({ error: "Something went wrong reading that website. Please try again." }, { status: 500 });
  }
}

/*
 * Say which of these are already on Proximity, before the landlord works: the
 * landlord's own first ("On Proximity, yours"), then anyone's.
 */
async function markAlreadyListed(properties, userId) {
  const pickable = properties.filter((p) => p.kind !== "group");
  if (!pickable.length) return properties;
  const owned = await getOwnedListings(userId);
  const [listed, mine] = await Promise.all([
    findExistingProperties(pickable),
    findExistingProperties(pickable, { ids: [...owned.keys()] }),
  ]);
  /*
   * Whose it is. Three answers, and the workspace treats each differently:
   *   you      your own record, or you hold a lease there: the read becomes
   *            proposed changes you accept on that tab
   *   none     listed by Proximity with no landlord behind it (an import or a
   *            review stub): ticking it makes it yours, then as above
   *   other    another landlord's: shown, not read, with a way to add your
   *            own units to it by hand
   */
  const hitIds = [...new Set([...listed.values(), ...mine.values()].map((h) => h.id))];
  const placeholderId = await resolveProximityLandlordId().catch(() => null);
  const { data: landlordRows } = hitIds.length ? await supabase.from("listing_landlords").select("listing_id, user_id").in("listing_id", hitIds) : { data: [] };
  const realOwners = new Set((landlordRows ?? []).filter((r) => r.user_id && r.user_id !== placeholderId).map((r) => r.listing_id));
  return properties.map((p) => {
    const own = mine.get(p);
    const hit = own ?? listed.get(p);
    return hit
      ? {
          ...p,
          alreadyListed: {
            id: hit.id,
            title: hit.title ?? null,
            address: hit.address ?? null,
            mine: own ? (owned.get(hit.id) === "lease" ? "lease" : "owner") : null,
            owner: own ? "you" : realOwners.has(hit.id) ? "other" : "none",
          },
        }
      : p;
  });
}
