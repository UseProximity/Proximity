export const dynamic = "force-dynamic";

import { requireDbRole } from "@/lib/userRole";
import { getSupabaseClient } from "@/lib/supabase";

/*
 * One sent email's body, for the "View email" dropdown on the admin "Sent
 * emails" page (Wyatt, 2026-10-24). The stored body already has every token in
 * its links replaced by [removed] (lib/emailLog.js). Emails logged before the
 * page existed (copied from chat_email_log) have no body.
 *
 * Honours the dashboard's dev/prod switch via the x-db-target header.
 *
 * @auth admin
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

export async function GET(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  if (!UUID.test(id ?? "")) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = getSupabaseClient(getDbTarget(req));
  const { data, error } = await supabase
    .from("sent_emails")
    .select("id, from_email, body_html, body_text")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("admin sent email body failed:", error);
    return Response.json({ error: "Could not load the email" }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    fromEmail: data.from_email,
    html: data.body_html,
    text: data.body_text,
  });
}
