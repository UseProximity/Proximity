export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";

/*
 * GET  /api/admin/errors?status=open|resolved|all
 *      Site errors, grouped (lib/errors/record.js, Wyatt, 2026-11-03),
 *      most recently seen first: where, the message, how often, when first
 *      and last seen, the latest occurrence's page and browser, the stack.
 * POST /api/admin/errors { id, action: "resolve" | "reopen" }
 *      Mark a problem fixed (it reopens, and emails again, if it recurs).
 *      A write, so super only; admin is the read-only half.
 *
 * Honours x-db-target like the other admin reads.
 *
 * @auth admin
 */

const COLUMNS = "id, source, where_label, message, stack, sample, app_env, count, first_seen_at, last_seen_at, last_alerted_at, resolved_at, reopened_at";

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

export async function GET(req) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const supabase = getSupabaseClient(getDbTarget(req));
  const status = new URL(req.url).searchParams.get("status") ?? "open";
  try {
    let q = supabase.from("app_errors").select(COLUMNS).order("last_seen_at", { ascending: false }).limit(500);
    if (status === "open") q = q.is("resolved_at", null);
    else if (status === "resolved") q = q.not("resolved_at", "is", null);
    const { data, error } = await q;
    if (error) throw error;
    return Response.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/admin/errors failed:", err);
    return Response.json({ error: "Could not load errors" }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await requireDbRole(["super"]);
  if (!session) return Response.json({ error: "Only a super admin can change this" }, { status: 403 });
  const supabase = getSupabaseClient(getDbTarget(req));
  try {
    const { id, action } = await req.json().catch(() => ({}));
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || !["resolve", "reopen"].includes(action)) {
      return Response.json({ error: "Bad request" }, { status: 400 });
    }
    const patch = action === "resolve"
      ? { resolved_at: new Date().toISOString(), resolved_by: session.user?.id ?? null }
      : { resolved_at: null, resolved_by: null };
    let { error } = await supabase.from("app_errors").update(patch).eq("id", id);
    // Looking at the other database, the admin's own user id may not exist there.
    if (error?.code === "23503") ({ error } = await supabase.from("app_errors").update({ ...patch, resolved_by: null }).eq("id", id));
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/errors failed:", err);
    return Response.json({ error: "Could not update" }, { status: 500 });
  }
}
