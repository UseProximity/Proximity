/*
 * DELETE /api/account — user-initiated account deletion.
 *
 * Required by Apple App Store Guideline 5.1.1(v) and Google Play's data-deletion
 * policy for any app that offers account creation, and by the CCPA right to
 * delete.
 *
 * Two-stage by design (30-day grace period):
 *   Stage 1 (here)  — soft-delete: stamp users.deleted_at. Every auth path
 *                     checks that column (see auth.js), so the account stops
 *                     authenticating immediately and disappears from the app.
 *   Stage 2 (cron)  — hard purge after 30 days: scrub PII, drop behavioral rows
 *                     (matchmaking rows are kept three years), anonymize reviews, redact action_log,
 *                     delete the profile photo. See api/cron/purge-accounts.
 *
 * Listings are handled here rather than left to the users.deleted_at trigger
 * (fn_handle_user_soft_delete), which would soft-delete EVERY listing the user
 * is attached to — including ones co-owned with another landlord who is not
 * leaving. Co-owned listings are transferred; only sole-owned ones go away.
 *
 * The transfer loop is not one transaction (PostgREST gives us no way to open
 * one without an RPC), so it is written to be safely repeatable instead: a step
 * that fails returns 500 BEFORE the account is soft-deleted, and a retry skips
 * the listings already handled because their link is gone. The failure state is
 * "some listings transferred, account still live", which the user resolves by
 * pressing Delete again. The state we must never reach is "account deleted,
 * co-owner's listing withdrawn with it", so every step that could cause it
 * aborts the request.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import supabase from "@/lib/supabase";

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const { data: me, error: meErr } = await supabase
      .from("users")
      .select("id, email, name, phone, is_system, deleted_at")
      .eq("id", userId)
      .single();

    if (meErr || !me) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // Reserved non-human rows (see the seed migration) must never be deletable.
    if (me.is_system) {
      return NextResponse.json({ error: "This account cannot be deleted" }, { status: 403 });
    }
    // Reachable only briefly: a deleted session goes dead once auth.js's
    // role-refresh window (ROLE_REFRESH_MS) elapses. Inside that window a
    // retry can still land here, so answer it as a no-op success instead of a
    // confusing failure.
    if (me.deleted_at) {
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    // --- Listings: transfer co-owned, let sole-owned fall to the trigger ------
    const { data: links, error: linkErr } = await supabase
      .from("listing_landlords")
      .select("listing_id, is_primary")
      .eq("user_id", userId);

    if (linkErr) {
      console.error("[account DELETE] could not read listing links:", linkErr);
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
    }

    let transferred = 0;
    let removed = 0;

    for (const link of links ?? []) {
      const { data: others, error: othersErr } = await supabase
        .from("listing_landlords")
        .select("user_id, is_primary")
        .eq("listing_id", link.listing_id)
        .neq("user_id", userId)
        // Deterministic successor: an existing primary first, then oldest link.
        // Without an order the "winner" is whatever Postgres returns that day.
        .order("is_primary", { ascending: false })
        .order("user_id", { ascending: true });

      if (othersErr) {
        // Stop before the soft-delete below. Guessing wrong here means either
        // orphaning a co-owner's listing or withdrawing it from under them, so
        // a failed read has to abort the whole deletion rather than continue.
        console.error("[account DELETE] could not read co-owners:", othersErr);
        return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
      }

      if (!others?.length) {
        // Sole owner — leave the link in place so the users.deleted_at trigger
        // soft-deletes this listing along with the account.
        removed += 1;
        continue;
      }

      // Detach the departing owner. The listing survives under its co-owner(s),
      // so it must NOT still be linked when the trigger fires. A failure here
      // is the one that actually withdraws a co-owner's live listing, so it
      // aborts rather than falling through to the soft-delete.
      const { error: detachErr } = await supabase
        .from("listing_landlords")
        .delete()
        .eq("listing_id", link.listing_id)
        .eq("user_id", userId);

      if (detachErr) {
        console.error("[account DELETE] could not detach co-owned listing:", detachErr);
        return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
      }

      const successor = others[0];
      if (link.is_primary) {
        await supabase
          .from("listing_landlords")
          .update({ is_primary: true })
          .eq("listing_id", link.listing_id)
          .eq("user_id", successor.user_id);
      }

      // The listing's public contact fields may still hold the departing user's
      // details — that's their personal data staying live on someone else's
      // listing. Hand contact over to the successor when it was ours. Any of
      // the three fields matching is enough: a listing can publish a shared
      // inbox but the leaver's own mobile number, and that number is just as
      // much their data as the address is.
      const { data: listing } = await supabase
        .from("listings")
        .select("contact_email, contact_name, contact_phone")
        .eq("id", link.listing_id)
        .single();

      const isOurs =
        (me.email && listing?.contact_email === me.email) ||
        (me.phone && listing?.contact_phone === me.phone) ||
        (me.name && listing?.contact_name === me.name);

      if (isOurs) {
        const { data: successorUser } = await supabase
          .from("users")
          .select("name, email, phone")
          .eq("id", successor.user_id)
          .single();
        await supabase
          .from("listings")
          .update({
            contact_email: successorUser?.email ?? null,
            contact_name: successorUser?.name ?? null,
            contact_phone: successorUser?.phone ?? null,
          })
          .eq("id", link.listing_id);
      }

      transferred += 1;
    }

    // --- Soft-delete the account ---------------------------------------------
    // Fires fn_handle_user_soft_delete, which soft-deletes the listings this
    // user is still attached to (by now: only the sole-owned ones).
    const { error: delErr } = await supabase
      .from("users")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", userId);

    if (delErr) {
      console.error("[account DELETE] soft-delete failed:", delErr);
      return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      listingsTransferred: transferred,
      listingsRemoved: removed,
    });
  } catch (err) {
    console.error("[account DELETE] unexpected error:", err);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
