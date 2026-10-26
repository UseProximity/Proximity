export const dynamic = "force-dynamic";
// Reading a company's front page and asking which buildings it lists can take
// a while on a JS-heavy site; the per-property reads run as background jobs.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { discoverSite } from "@/lib/sourceImport/read";
import { markAlreadyListed } from "@/lib/sourceImport/alreadyListed";
import { spendImport } from "@/lib/sourceImport/limits";

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
  document_unreadable: [422, "We couldn't read that file. If it's a Google Sheet or Doc, set sharing to \"Anyone with the link\", or paste your website instead."],
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

    // Counted against the account's and the site's caps before anything paid runs.
    const spend = await spendImport({ userId: session.user.id, kind: "picker", isSuper: session.user.role === "super" });
    if (!spend.ok) return NextResponse.json({ error: spend.error }, { status: spend.status });

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
