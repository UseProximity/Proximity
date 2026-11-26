import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import {
  getContactEmailStatuses,
  normalizeContactEmail,
  requestContactVerification,
} from "@/lib/chat/contactVerification";

const MAX_EMAILS = 50;

/*
 * Confirmation status of the caller's contact addresses, for the listing editor.
 * GET ?emails=a@x.com,b@y.com  ->  { statuses: { "a@x.com": "confirmed", ... } }
 *
 * Only ever answers for the caller's own account, so it cannot be used to learn
 * whether another landlord has confirmed an address.
 *
 * @auth user
 */
export async function GET(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = new URL(req.url).searchParams.get("emails") || "";
  const emails = raw.split(",").slice(0, MAX_EMAILS);
  const statuses = await getContactEmailStatuses(session.user.id, emails);
  return NextResponse.json({ statuses });
}

/*
 * Send (or resend) the confirmation link for one address.
 * POST { email }  ->  { status: "sent" | "confirmed" | "skipped" | "failed" }
 *
 * "skipped" here means a link went out in the last few minutes.
 *
 * @auth user
 */
export async function POST(req) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const email = normalizeContactEmail(body?.email);
  if (!email) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  // Only addresses already on one of the caller's own leases or listings, so
  // this cannot be used to send our email to arbitrary inboxes. ilike for case,
  // with its wildcards escaped since "_" is common in addresses.
  const pattern = email.replace(/[\\%_]/g, "\\$&");
  const [{ data: leaseHit }, { data: ownedListings }] = await Promise.all([
    supabase
      .from("unit_leases")
      .select("id")
      .eq("owner_id", session.user.id)
      .is("deleted_at", null)
      .ilike("contact_email", pattern)
      .limit(1),
    supabase.from("listing_landlords").select("listing_id").eq("user_id", session.user.id),
  ]);
  let onFile = (leaseHit ?? []).length > 0;
  if (!onFile && (ownedListings ?? []).length > 0) {
    const { data: listingHit } = await supabase
      .from("listings")
      .select("id")
      .in("id", ownedListings.map((r) => r.listing_id))
      .is("deleted_at", null)
      .ilike("contact_email", pattern)
      .limit(1);
    onFile = (listingHit ?? []).length > 0;
  }
  if (!onFile) {
    return NextResponse.json(
      { error: "That address isn't a contact on any of your listings." },
      { status: 400 }
    );
  }

  const status = await requestContactVerification({
    landlordId: session.user.id,
    email,
    baseUrl: getBaseUrl(req),
  });
  if (status === "failed") {
    return NextResponse.json({ error: "Could not send the confirmation email." }, { status: 500 });
  }
  return NextResponse.json({ status });
}
