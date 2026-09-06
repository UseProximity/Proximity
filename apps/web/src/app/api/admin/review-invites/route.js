/*
 * Send and review tokenized review invites.
 *
 * @auth admin
 *
 * Only the Proximity team can invite. That is the whole reason invited reviews
 * can be trusted more than open ones: if landlords could send these, a landlord
 * would invite five friends and the badge would mean the opposite of what it
 * says. The existing per-landlord link (/review-invite/<landlordId>) stays as
 * it is for landlords, unverified and signed-in-only.
 *
 * Deliberately NOT wired to the dashboard's dev/prod switch. Every other admin
 * route reads x-db-target and can act on either database; an invite must not,
 * because it writes a row that a later review has to find. Minting against prod
 * from a local dashboard would mail a link this app cannot resolve. Invites go
 * to whichever database the running app already serves, and nowhere else.
 *
 * INTERPOLATION HAPPENS HERE, NOT IN THE BROWSER. The composer sends a message
 * template; each recipient's {link} is filled in server-side. It could not work
 * any other way: the token is generated in this handler and handed straight to
 * the email, so a browser that could interpolate a link would be a browser
 * holding 200 working credentials.
 *
 * Sending is capped per request. A bulk campaign is chunked by the caller into
 * requests of this size, which keeps each one well inside the function timeout
 * and gives the admin real progress instead of one long spinner that might be
 * a hung connection.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { getBaseUrl, sendReviewInviteEmail } from "@/lib/email";
import { isReviewEligibleEmail } from "@/lib/schools";
import {
  mintInvite,
  markInviteSent,
  discardInvite,
  INVITE_TTL_DAYS,
} from "@/lib/reviews/invites";

export const dynamic = "force-dynamic";

/*
 * One chunk of a campaign. Gmail SMTP takes roughly a second per message, so 50
 * is about a minute: comfortably inside the 300s function limit even on a slow
 * day, and small enough that a failure costs one chunk rather than the campaign.
 */
const MAX_PER_REQUEST = 50;

async function requireSuperOrAdmin() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const { data: user } = await supabase
    .from("users")
    .select("id, roles!role_id(name)")
    .eq("email", session.user.email.toLowerCase())
    .maybeSingle();
  if (!user || (user.roles?.name !== "super" && user.roles?.name !== "admin")) return null;
  return user;
}

/**
 * The invite ledger, newest first, with the status the admin table renders.
 *
 * Never returns a token or a hash. There is no token to return (only the hash
 * is stored) and the hash is not useful to a browser, so it stays server-side.
 */
export async function GET(req) {
  try {
    const user = await requireSuperOrAdmin();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);

    const { data, error } = await supabase
      .from("review_invites")
      .select(
        "id, invited_email, sent_at, expires_at, used_at, review_kind, created_at, listings!listing_id(address, title), inviter:users!invited_by(name, email)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const now = Date.now();
    const invites = (data || []).map((row) => ({
      id: row.id,
      email: row.invited_email,
      sentAt: row.sent_at,
      usedAt: row.used_at,
      expiresAt: row.expires_at,
      reviewKind: row.review_kind,
      listing: row.listings?.title || row.listings?.address || null,
      invitedBy: row.inviter?.name || row.inviter?.email || null,
      status: row.used_at
        ? "used"
        : new Date(row.expires_at).getTime() < now
        ? "expired"
        : row.sent_at
        ? "sent"
        : "pending",
    }));

    const counts = invites.reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }), {});
    return NextResponse.json({ invites, counts });
  } catch (err) {
    console.error("admin/review-invites GET:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * Work out who this request is actually for.
 *
 * Two shapes, because the composer has two ways to pick people: checkboxes and
 * a random draw both produce roster ids, while the paste box produces raw
 * addresses. Roster ids are preferred where available since they carry the
 * first name the template needs without a second lookup.
 */
async function resolveRecipients(body) {
  const rosterIds = Array.isArray(body.rosterIds) ? body.rosterIds.filter(Boolean) : [];

  if (rosterIds.length) {
    const { data, error } = await supabase
      .from("student_roster")
      .select("id, email, first_name")
      .in("id", rosterIds.slice(0, MAX_PER_REQUEST));
    if (error) throw error;
    return (data || []).map((r) => ({
      email: String(r.email || "").trim().toLowerCase(),
      rosterId: r.id,
      firstName: (r.first_name || "").trim(),
    }));
  }

  // Tolerate a pasted block of text: an admin copying a column out of a
  // spreadsheet should not have to reformat it first.
  const raw = Array.isArray(body.emails)
    ? body.emails
    : String(body.emails || body.email || "").split(/[\s,;]+/);
  const emails = [...new Set(raw.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];

  // One lookup for the whole batch rather than one per address, so a 50-person
  // chunk costs a single round trip instead of fifty.
  const { data: roster } = await supabase
    .from("student_roster")
    .select("id, email, first_name")
    .in("email", emails);
  const byEmail = new Map(
    (roster || []).map((r) => [String(r.email).toLowerCase(), r])
  );

  return emails.map((email) => {
    const match = byEmail.get(email);
    return {
      email,
      rosterId: match?.id ?? null,
      firstName: (match?.first_name || "").trim(),
    };
  });
}

/**
 * Mint and send one invite per recipient.
 *
 * Per-recipient results rather than a single pass/fail: one bad address in a
 * chunk must not silently cost the other forty-nine their email, and the
 * composer replays the failures back to the admin by name.
 */
export async function POST(req) {
  try {
    const user = await requireSuperOrAdmin();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const listingId = body.listingId || null;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    /*
     * A custom message that never renders the link is an email that wastes a
     * token and asks the student to do something they have no way to do. Caught
     * here as well as in the composer, because this endpoint is reachable
     * without it.
     */
    if (message && !message.includes("{link}")) {
      return NextResponse.json(
        { error: "Your message must include {link} so the student has something to click." },
        { status: 400 }
      );
    }
    const needsFirstName = message.includes("{first_name}");

    const recipients = await resolveRecipients(body);
    if (!recipients.length) {
      return NextResponse.json({ error: "Add at least one recipient." }, { status: 400 });
    }
    if (recipients.length > MAX_PER_REQUEST) {
      return NextResponse.json(
        { error: `Send to at most ${MAX_PER_REQUEST} people at a time.` },
        { status: 400 }
      );
    }

    const baseUrl = getBaseUrl(req);
    const results = [];

    for (const person of recipients) {
      const { email, rosterId, firstName } = person;

      if (!isReviewEligibleEmail(email)) {
        results.push({ email, ok: false, error: "Not a school email we recognize." });
        continue;
      }

      /*
       * "Hi ," is worse than no email at all, and it is the kind of mistake
       * that gets noticed by 200 people at once. The composer already filters
       * these out; this is the backstop for a paste-box send.
       */
      if (needsFirstName && !firstName) {
        results.push({ email, ok: false, error: "No first name on file." });
        continue;
      }

      /*
       * An outstanding invite is reused rather than replaced: minting a second
       * token would leave the first one live, so a student holding the older
       * email would find a link that still worked but pointed at a stale row.
       * Once one is used or expired, a fresh invite is exactly what a resend is.
       * This is also the guard that makes a double-send harmless if an admin
       * selects someone twice across two campaigns.
       */
      const { data: outstanding } = await supabase
        .from("review_invites")
        .select("id")
        .eq("invited_email", email)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (outstanding) {
        results.push({ email, ok: false, error: "Already has a live invite." });
        continue;
      }

      const minted = await mintInvite({ email, rosterId, listingId, invitedBy: user.id });
      if (minted.error) {
        results.push({ email, ok: false, error: minted.error });
        continue;
      }

      try {
        await sendReviewInviteEmail({
          email,
          firstName: firstName || null,
          token: minted.token,
          baseUrl,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString(),
          subject: subject || null,
          message: message || null,
        });
        await markInviteSent(minted.inviteId);
        results.push({ email, ok: true });
      } catch (err) {
        // The token is now unreachable (it was never persisted in plaintext and
        // never left this scope), so the row is dead weight. Drop it so a retry
        // is not refused by the outstanding-invite check above.
        console.error("[admin/review-invites] send failed:", email, err?.message);
        await discardInvite(minted.inviteId);
        results.push({ email, ok: false, error: "Email failed to send." });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return NextResponse.json({ sent, failed: results.length - sent, results });
  } catch (err) {
    console.error("admin/review-invites POST:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
