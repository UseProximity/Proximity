export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { auth } from "@/auth";
import { isProdData } from "@/lib/appEnv";
import { getSupabaseClient } from "@/lib/supabase";
import { processInboundEmail } from "@/lib/chat/inboundEmail";
import { decideSender, removeSender } from "@/lib/chat/replySenderApproval";

/*
 * Admin control over emailed replies that were not posted (Wyatt, 2026-10-24),
 * from the Conversations view.
 *
 *   POST { inboundId, action: "approve" | "decline", scope: "address" | "domain" }
 *        decide, on the landlord's behalf, about the sender of one received
 *        reply. Approving delivers every reply held from them, and this one
 *        too if it was refused for another reason before (an identity check
 *        that has since been fixed, say).
 *   POST { inboundId, action: "retry" }
 *        run one refused reply through today's rules again, with no decision.
 *        A reply from someone new is then held and the landlord is asked.
 *   DELETE { landlordId, id }
 *        remove an entry from a landlord's list.
 *
 * Decisions honour the dashboard's dev/prod switch (x-db-target). Re-running a
 * reply reads the stored email and posts through this environment's own
 * database, so it only happens when the switch points at that same database;
 * otherwise the decision is saved and the response says to re-run from there.
 *
 * @auth admin
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDbTarget(req) {
  const header = req.headers.get("x-db-target");
  return header === "prod" || header === "dev" ? header : undefined;
}

async function requireAdmin() {
  const session = await auth();
  if (!session || (session.user.role !== "super" && session.user.role !== "admin")) return null;
  return session;
}

// Only refused replies are re-run. 'posted' is done, 'processing' is in flight.
const RERUNNABLE = new Set(["unauthenticated", "wrong_sender", "held", "unknown_address", "empty", "rejected", "error", "spam", "auto_reply"]);

/** Move one row to 'error' (if it is still in the state read) and run it again. */
async function rerunOne(db, row) {
  const { data: taken } = await db
    .from("chat_inbound_emails")
    .update({ status: "error", reason: "re-run by admin" })
    .eq("id", row.id)
    .eq("status", row.status)
    .select("id")
    .maybeSingle();
  if (!taken) return { id: row.id, status: "skipped", reason: "changed while you were looking" };
  const out = await processInboundEmail({ bucket: process.env.AWS_INBOUND_MAIL_BUCKET, key: row.s3_key });
  return { id: row.id, fromEmail: row.from_email, status: out.status, reason: out.reason ?? null };
}

export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { inboundId, action, scope = "address" } = body ?? {};
  if (!UUID.test(String(inboundId ?? ""))) return Response.json({ error: "inboundId must be a valid UUID" }, { status: 400 });
  if (!["approve", "decline", "retry"].includes(action)) return Response.json({ error: "Invalid action" }, { status: 400 });

  const target = getDbTarget(req);
  const db = getSupabaseClient(target);
  const canRerun = !target || target === (isProdData() ? "prod" : "dev");

  try {
    const { data: row, error } = await db
      .from("chat_inbound_emails")
      .select("id, s3_key, from_email, status, user_id, thread_id, chat_threads:thread_id(landlord_id)")
      .eq("id", inboundId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    if (!RERUNNABLE.has(row.status)) return Response.json({ error: `This reply is ${row.status}` }, { status: 409 });

    if (action === "retry") {
      if (!canRerun) return Response.json({ error: "Switch the dashboard to this site's own database to re-run replies" }, { status: 409 });
      return Response.json({ ok: true, results: [await rerunOne(db, row)] });
    }

    // A decision needs to know whose behalf the sender spoke on: the landlord
    // of the conversation the reply was addressed to.
    const landlordId = row.chat_threads?.landlord_id;
    if (!landlordId || !row.from_email) {
      return Response.json({ error: "This reply is not tied to a landlord's conversation" }, { status: 409 });
    }

    const out = await decideSender({
      db,
      landlordId,
      email: row.from_email,
      scope,
      decision: action,
      decidedBy: session.user.id ?? null,
      via: "admin",
      rerun: canRerun,
    });
    if (!out.ok) return Response.json({ error: out.error }, { status: 400 });

    // Approving also retries this reply when it was refused for another reason.
    const results = [...out.results];
    if (action === "approve" && canRerun && row.status !== "held") results.push(await rerunOne(db, row));

    return Response.json({
      ok: true,
      pattern: out.pattern,
      results,
      note: canRerun ? null : "Decision saved. Re-run the held replies from the site that uses this database.",
    });
  } catch (err) {
    console.error("POST /api/admin/chat/reply-senders failed:", err);
    return Response.json({ error: "Could not save the decision" }, { status: 500 });
  }
}

export async function DELETE(req) {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { landlordId, id } = body ?? {};
  if (!UUID.test(String(landlordId ?? "")) || !UUID.test(String(id ?? ""))) {
    return Response.json({ error: "landlordId and id must be valid UUIDs" }, { status: 400 });
  }
  try {
    const removed = await removeSender(getSupabaseClient(getDbTarget(req)), { landlordId, id });
    if (!removed) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/chat/reply-senders failed:", err);
    return Response.json({ error: "Could not remove it" }, { status: 500 });
  }
}
