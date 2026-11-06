export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminBillingDb, readOnlyResponse } from "@/lib/billing/adminDb";
import { requireDbRole } from "@/lib/userRole";
import { acceptRequest, declineRequest, replyAsAdmin } from "@/lib/billing/changeRequests";
import { storeChangeFile } from "@/lib/billing/changeRequestFiles";
import { changeRequestNotify } from "@/lib/billing/changeRequestNotify";
import { readChangeRequestBody } from "@/lib/billing/changeRequestHttp";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * Answering a landlord's change request. Every outcome emails the landlord.
 *
 * POST { action: "reply", body }      a message in the thread (multipart/form-data
 *                                     with an optional "file" too)
 *      { action: "decline", note }    closes it; the note is for the landlord
 *      { action: "accept", note? }    agrees to it. Then upload the negotiated
 *                                     document as a version for this landlord
 *                                     (agreement-versions with landlordId and
 *                                     changeRequestId) and make it live there.
 *
 * @auth admin
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const billingDb = adminBillingDb(req);
  if (!billingDb.writable) return readOnlyResponse(billingDb);
  const supabase = billingDb.db;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const input = await readChangeRequestBody(req);
    const notify = changeRequestNotify();
    const adminId = session.user.id;
    let request;
    if (input.action === "reply") {
      request = await replyAsAdmin(supabase, { adminId, requestId: id, body: input.body, file: input.file, storeFile: storeChangeFile, notify });
    } else if (input.action === "decline") {
      request = await declineRequest(supabase, { adminId, requestId: id, note: input.note, notify });
    } else if (input.action === "accept") {
      request = await acceptRequest(supabase, { adminId, requestId: id, note: input.note, notify });
    } else {
      throw new BillingError("bad_action", "Choose reply, decline or accept.");
    }
    return NextResponse.json({ request: { id: request.id, status: request.status } });
  } catch (err) {
    return billingErrorResponse(err, "answer change request");
  }
}
