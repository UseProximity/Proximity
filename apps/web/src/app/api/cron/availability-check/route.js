/*
 * Daily cron: one-click "still available?" asks for stale listings.
 *
 * The coverage backstop for every landlord WITHOUT a PMS connection: any
 * listing that looks live but hasn't been verified in STALE_AFTER_DAYS gets a
 * targeted email with signed Yes/No links (no login). One email per landlord
 * covering all their stale listings; a listing is never re-asked more often
 * than COOLDOWN_DAYS. Replaces the old bi-weekly blast with targeted asks.
 *
 * PMS-connected listings are excluded — their availability already syncs
 * daily. Outreach is env-gated via sendMailSafe (suppressed/redirected off
 * production). Protected by the same CRON_SECRET as the other crons.
 */
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { sendAvailabilityCheckEmail } from "@/lib/availabilityCheck";

const STALE_AFTER_DAYS = 30; // unverified this long -> ask
const COOLDOWN_DAYS = 14;    // never re-ask the same listing sooner
const MAX_RECIPIENTS = 50;   // per run — the window re-tiles daily anyway

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_AFTER_DAYS * 86400_000).toISOString();
  const cooldownCutoff = new Date(now - COOLDOWN_DAYS * 86400_000).toISOString();

  const { data: listings, error } = await supabase
    .from("listings")
    .select("id, title, address, contact_email, contact_name, listing_landlords(user_id, is_primary)")
    .is("deleted_at", null)
    .is("pms_connection_id", null)
    .or("unavailable.is.null,unavailable.eq.false")
    .or(`last_verified_at.is.null,last_verified_at.lt.${staleCutoff}`)
    .or(`availability_email_sent_at.is.null,availability_email_sent_at.lt.${cooldownCutoff}`)
    // Oldest-waiting first so the daily 300/50 caps drain the backlog fairly
    // instead of re-fetching the same physical rows every run.
    .order("availability_email_sent_at", { ascending: true, nullsFirst: true })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!listings?.length) return NextResponse.json({ checked: 0, emailed: 0 });

  // Resolve a recipient per listing: contact_email, else the primary
  // landlord's account email.
  const needOwner = listings.filter((l) => !l.contact_email);
  const ownerIds = [
    ...new Set(
      needOwner.flatMap((l) => {
        const ll = l.listing_landlords ?? [];
        const primary = ll.find((x) => x.is_primary) ?? ll[0];
        return primary ? [primary.user_id] : [];
      })
    ),
  ];
  const ownerById = new Map();
  if (ownerIds.length) {
    const { data: owners } = await supabase
      .from("users")
      .select("id, name, email")
      .in("id", ownerIds);
    for (const o of owners ?? []) ownerById.set(o.id, o);
  }

  // One email per recipient covering all their stale listings.
  const byRecipient = new Map(); // email -> { name, listings: [{id, label}] }
  for (const l of listings) {
    const ll = l.listing_landlords ?? [];
    const primary = ll.find((x) => x.is_primary) ?? ll[0];
    const owner = primary ? ownerById.get(primary.user_id) : null;
    const email = l.contact_email || owner?.email;
    if (!email) continue;
    const name = l.contact_name || owner?.name || null;
    if (!byRecipient.has(email)) byRecipient.set(email, { name, listings: [] });
    byRecipient.get(email).listings.push({ id: l.id, label: l.title || l.address || "Your listing" });
  }

  const baseUrl = getBaseUrl(req);
  let emailed = 0;
  const stampIds = [];
  for (const [email, { name, listings: group }] of byRecipient) {
    if (emailed >= MAX_RECIPIENTS) break;
    try {
      await sendAvailabilityCheckEmail({ email, name, listings: group, baseUrl });
      emailed += 1;
      stampIds.push(...group.map((g) => g.id));
    } catch (err) {
      console.error("[availability-check] failed to email", email, err?.message);
    }
  }

  if (stampIds.length) {
    await supabase
      .from("listings")
      .update({ availability_email_sent_at: new Date().toISOString() })
      .in("id", stampIds);
  }

  return NextResponse.json({ checked: listings.length, recipients: byRecipient.size, emailed });
}
