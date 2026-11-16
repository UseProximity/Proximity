/*
 * PATCH /api/admin/users/[id]: the account actions on a person's admin record
 * (Wyatt, 2026-11-14). Each used to mean typing a raw value into the gear
 * drawer.
 *
 *   { action: "setRole", role }            student | landlord | parent | other | admin | super
 *   { action: "setTest", on }              flag or unflag a test (review sandbox) account
 *   { action: "setEmailAlerts", on }       turn their email notifications on or off
 *   { action: "restore" }                  bring a deleted account back, with the
 *                                          listings its deletion took down
 *
 * Follows the dashboard's dev/prod switch, except restore, which only runs on
 * this site's own database (it goes through the same path as a self-restore).
 *
 * @auth super
 */
export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { adminDb } from "@/lib/admin/adminDb";
import { isUuid } from "@/lib/admin/records";
import { findRestorableById, restoreAccount } from "@/lib/auth/accountRestore";

const ROLES = new Set(["student", "landlord", "parent", "other", "admin", "super"]);

export async function PATCH(req, { params }) {
  const session = await requireDbRole(["super"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { db, writable } = adminDb(req);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === "setRole") {
      if (!ROLES.has(body.role)) return Response.json({ error: "Unknown role" }, { status: 400 });
      // Nobody removes their own super role by a slip of the hand.
      if (writable && id === session.user.id && body.role !== "super") return Response.json({ error: "You cannot change your own role." }, { status: 400 });
      const { data: role } = await db.from("roles").select("id").eq("name", body.role).maybeSingle();
      if (!role) return Response.json({ error: "That role does not exist in this database." }, { status: 400 });
      const { data, error } = await db.from("users").update({ role_id: role.id }).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) return Response.json({ error: "No such user" }, { status: 404 });
      return Response.json({ ok: true });
    }

    if (body.action === "setTest" || body.action === "setEmailAlerts") {
      const column = body.action === "setTest" ? "review_sandbox" : "email_notifications";
      const { data, error } = await db.from("users").update({ [column]: body.on === true }).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) return Response.json({ error: "No such user" }, { status: 404 });
      return Response.json({ ok: true });
    }

    if (body.action === "restore") {
      if (!writable) return Response.json({ error: "Restore an account on the site that owns this database." }, { status: 409 });
      const user = await findRestorableById(id);
      if (!user) return Response.json({ error: "This account cannot be restored: it is not deleted, or its 30 days have passed." }, { status: 400 });
      const result = await restoreAccount(user);
      if (!result.ok) return Response.json({ error: "Could not restore the account" }, { status: 500 });
      return Response.json({ ok: true, listingsRestored: result.listingsRestored ?? 0 });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("PATCH admin/users failed:", err);
    return Response.json({ error: "Could not make that change" }, { status: 500 });
  }
}
