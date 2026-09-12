/*
 * The off-site waitlist hand-off for a property that takes interest through its
 * own form (LOCAL on Delmar's is a Google Form).
 *
 * Two doors onto the same destination, because the thing we need is a name and
 * we get it two different ways:
 *
 *   GET:  a signed-in student. We already know them, so there is nothing to
 *          ask: log the click against their user id, prefill the landlord's
 *          form from their profile, redirect. A plain <a> keeps middle-click
 *          and "open in new tab" working.
 *   POST: a signed-out one. The listing asks for name/email/phone first; this
 *          mints a shell Proximity account from the answers, logs the click
 *          against it, and hands the caller a prefilled URL to open. Nothing is
 *          redirected here: the browser has to open the tab itself, inside the
 *          original click, or a popup blocker eats it.
 *
 * Once the browser is on docs.google.com we can see nothing further, so this is
 * the last moment either door can name who we sent. Logging therefore never
 * blocks the hand-off: a student who clicks Waitlist must reach the waitlist, so
 * a DB failure is logged and swallowed. The commission conversation reconciles
 * against the landlord's own response sheet regardless, and a missing row there
 * is better than a dead end here.
 *
 * @auth any
 */

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { waitlistFor, resolveWaitlistUrl } from "@/lib/waitlists";
import { ensureReviewerAccount } from "@/lib/reviews/onboarding";

// Names the signed-out browser across visits so repeat clicks from one person
// don't read as several. A year outlives a leasing cycle, which is the window
// any of this gets reconciled over.
const VISITOR_COOKIE = "prx_vid";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Checked before the query so a hand-typed path is a 404 and not a Postgres
// "invalid input syntax for type uuid" surfacing as a 500.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FIELD = 200;

/**
 * The listing and its waitlist, or an error response. The property key decides
 * the destination, so it is read from the DB and never from the query string:
 * taking a URL from the caller would turn this route into an open redirect
 * wearing our own domain.
 */
async function loadWaitlist(listingId) {
  if (!listingId || typeof listingId !== "string" || !UUID_RE.test(listingId.trim())) {
    return { error: NextResponse.json({ error: "Listing not found" }, { status: 404 }) };
  }

  const { data: listing, error } = await supabase
    .from("listings")
    .select("id, property_key")
    .eq("id", listingId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[waitlist] listing lookup failed:", error.message);
    return { error: NextResponse.json({ error: "Lookup failed" }, { status: 500 }) };
  }

  const waitlist = listing ? waitlistFor(listing.property_key) : null;
  if (!waitlist || !resolveWaitlistUrl(waitlist)) {
    if (waitlist) {
      console.error(
        "[waitlist] configured but its URL is missing or invalid:",
        listing.property_key
      );
    }
    return {
      error: NextResponse.json({ error: "No waitlist for this listing" }, { status: 404 }),
    };
  }

  return { listing, waitlist };
}

/**
 * Record the click. Never throws and never blocks the hand-off.
 *
 * A session can outlive the row it names: cookies survive a user deletion, and
 * locally they survive a prod-to-dev snapshot that never had the account. The
 * user_id FK then rejects the whole insert and the click disappears, which is
 * the one outcome worth writing code to avoid, so that case retries anonymously.
 */
async function logClick(click) {
  let { error } = await supabase.from("waitlist_clicks").insert(click);

  if (error?.code === "23503") {
    console.warn("[waitlist] unknown user_id, logging click anonymously:", click.user_id);
    ({ error } = await supabase.from("waitlist_clicks").insert({ ...click, user_id: null }));
  }

  if (error) console.error("[waitlist] click log failed:", error.message);
}

function trim(value) {
  return String(value ?? "").trim().slice(0, MAX_FIELD);
}

// ---------------------------------------------------------------------------
// GET: signed-in hand-off (and the plain link for everyone else)
// ---------------------------------------------------------------------------

export async function GET(req, { params }) {
  try {
    const { listingId } = await params;
    const loaded = await loadWaitlist(listingId);
    if (loaded.error) return loaded.error;
    const { listing, waitlist } = loaded;

    const session = await auth().catch(() => null);
    const userId = session?.user?.id ?? null;

    /*
     * Read the profile rather than the session: the session carries a name and
     * email but never a phone, and the landlord's form asks for one.
     */
    let profile = null;
    if (userId) {
      const { data } = await supabase
        .from("users")
        .select("name, email, phone")
        .eq("id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      profile = data ?? null;
    }

    // "N/A" is the signup form's placeholder for a number it couldn't ask for.
    // Sending it to the landlord would be worse than sending nothing.
    const phone = profile?.phone && profile.phone !== "N/A" ? profile.phone : "";

    const destination = resolveWaitlistUrl(waitlist, {
      name: profile?.name ?? "",
      email: profile?.email ?? "",
      phone,
    });

    const existingVisitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? null;
    const visitorId = existingVisitorId || randomUUID();

    /*
     * The contact details are copied onto the row even though user_id already
     * points at them. It is denormalized on purpose: this table is read directly
     * in the DB when reconciling our leads against the landlord's response
     * sheet, and joining out to users for every row makes that job harder than
     * it needs to be. It also freezes what we actually sent, which a later
     * profile edit would otherwise quietly rewrite.
     */
    await logClick({
      listing_id: listing.id,
      user_id: userId,
      visitor_id: visitorId,
      name: profile?.name || null,
      email: profile?.email || null,
      // Already normalized above: the signup placeholder is not a phone number.
      phone: phone || null,
      referrer: req.headers.get("referer"),
    });

    const res = NextResponse.redirect(destination, 302);

    if (!existingVisitorId) {
      res.cookies.set(VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE,
      });
    }

    return res;
  } catch (err) {
    console.error("[waitlist GET] unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST: signed-out hand-off: capture, mint an account, return the prefilled URL
// ---------------------------------------------------------------------------

export async function POST(req, { params }) {
  try {
    const { listingId } = await params;
    const loaded = await loadWaitlist(listingId);
    if (loaded.error) return loaded.error;
    const { listing, waitlist } = loaded;

    const body = await req.json().catch(() => ({}));
    const firstName = trim(body.firstName);
    const lastName = trim(body.lastName);
    const email = trim(body.email).toLowerCase();
    const phone = trim(body.phone);

    if (!firstName || !email) {
      return NextResponse.json(
        { error: "Please enter your name and email." },
        { status: 400 }
      );
    }
    // Deliberately loose. The address only has to be good enough to mail; the
    // landlord's form does its own checking, and rejecting an unusual but valid
    // address would cost a lead to enforce a rule nothing here depends on.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    /*
     * A signed-in student who somehow posts here is answering for themselves, so
     * their session wins over whatever the body claims. Without this, a stale
     * modal could attach one person's lead to another person's account.
     */
    const session = await auth().catch(() => null);
    let userId = session?.user?.id ?? null;
    let setupToken = null;

    if (!userId) {
      /*
       * Same shell-account machinery as the signed-out review flow: a real
       * users row with profile_complete false and no credentials, plus a
       * setup token that can edit that profile and nothing else. It refuses to
       * hand a token to an account that already has credentials, which is what
       * stops someone typing a classmate's address and getting an edit link.
       *
       * requireSchoolEmail is off here: a parent or a non-WashU roommate joining
       * a building's waitlist is a real lead.
       */
      const account = await ensureReviewerAccount({
        firstName,
        lastName,
        email,
        phone,
        requireSchoolEmail: false,
        referralSource: "Waitlist",
      });

      if (account.error) {
        return NextResponse.json({ error: account.error }, { status: 400 });
      }
      userId = account.userId;
      setupToken = account.setupToken;
    }

    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    const destination = resolveWaitlistUrl(waitlist, { name: fullName, email, phone });

    const existingVisitorId = req.cookies.get(VISITOR_COOKIE)?.value ?? null;
    const visitorId = existingVisitorId || randomUUID();

    await logClick({
      listing_id: listing.id,
      user_id: userId,
      visitor_id: visitorId,
      name: fullName,
      email,
      phone: phone || null,
      referrer: req.headers.get("referer"),
    });

    const res = NextResponse.json({
      url: destination,
      // Drives the "finish your account" prompt in the tab they came from. Null
      // for someone who already has a real account: there is nothing to finish.
      setupToken,
      firstName,
    });

    if (!existingVisitorId) {
      res.cookies.set(VISITOR_COOKIE, visitorId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE,
      });
    }

    return res;
  } catch (err) {
    console.error("[waitlist POST] unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
