/*
 * DELETE /api/account — user-initiated account deletion.
 *
 * Required by Apple App Store Guideline 5.1.1(v) and Google Play's data-deletion
 * policy for any app that offers account creation, and by the CCPA right to
 * delete. Works for web (NextAuth session) and mobile (Bearer token) alike via
 * getRequestUser — never `auth()` alone, which would silently 401 every mobile
 * caller.
 *
 * Two-stage by design (30-day grace period):
 *   Stage 1 (here)  — soft-delete: stamp users.deleted_at. Every auth path
 *                     checks that column (see auth.js, getRequestUser.js, the
 *                     mobile login/google/refresh routes), so the account stops
 *                     authenticating immediately and disappears from the app.
 *   Stage 2 (cron)  — hard purge after 30 days: scrub PII, drop behavioral and
 *                     matchmaking rows, anonymize reviews, redact action_log,
 *                     delete the profile photo. See api/cron/purge-accounts.
 *
 * Listings are handled here rather than left to the users.deleted_at trigger
 * (fn_handle_user_soft_delete), which would soft-delete EVERY listing the user
 * is attached to — including ones co-owned with another landlord who is not
 * leaving. Co-owned listings are transferred; only sole-owned ones go away.
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getRequestUser } from "@/lib/getRequestUser";

export async function DELETE(req) {
  try {
    const requestUser = await getRequestUser(req);
    if (!requestUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = requestUser.id;

    const { data: me, error: meErr } = await supabase
      .from("users")
      .select("id, email, is_system, deleted_at")
      .eq("id", userId)
      .single();

    if (meErr || !me) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // Reserved non-human rows (see the seed migration) must never be deletable.
    if (me.is_system) {
      return NextResponse.json({ error: "This account cannot be deleted" }, { status: 403 });
    }
    // Reachable only on the web path, and only briefly: getRequestUser rejects a
    // deleted mobile token outright, and a deleted web session goes dead once
    // auth.js's role-refresh window (ROLE_REFRESH_MS) elapses. Inside that
    // window a retry can still land here, so answer it as a no-op success
    // instead of a confusing failure.
    if (me.deleted_at) {
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    // --- Listings: transfer co-owned, let sole-owned fall to the trigger ------
    const { data: links } = await supabase
      .from("listing_landlords")
      .select("listing_id, is_primary")
      .eq("user_id", userId);

    let transferred = 0;
    let removed = 0;

    for (const link of links ?? []) {
      const { data: others } = await supabase
        .from("listing_landlords")
        .select("user_id, is_primary")
        .eq("listing_id", link.listing_id)
        .neq("user_id", userId);

      if (!others?.length) {
        // Sole owner — leave the link in place so the users.deleted_at trigger
        // soft-deletes this listing along with the account.
        removed += 1;
        continue;
      }

      // Detach the departing owner. The listing survives under its co-owner(s),
      // so it must NOT still be linked when the trigger fires.
      await supabase
        .from("listing_landlords")
        .delete()
        .eq("listing_id", link.listing_id)
        .eq("user_id", userId);

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
      // listing. Hand contact over to the successor when it was ours.
      const { data: listing } = await supabase
        .from("listings")
        .select("contact_email")
        .eq("id", link.listing_id)
        .single();

      if (listing?.contact_email && me.email && listing.contact_email === me.email) {
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
