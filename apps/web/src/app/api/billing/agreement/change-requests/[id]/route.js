export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { replyAsLandlord, withdrawRequest } from "@/lib/billing/changeRequests";
import { storeChangeFile } from "@/lib/billing/changeRequestFiles";
import { changeRequestNotify } from "@/lib/billing/changeRequestNotify";
import { readChangeRequestBody } from "@/lib/billing/changeRequestHttp";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A landlord acting on their own change request.
 *
 * POST { action: "reply", body, proposedText? } (multipart/form-data with an
 *      optional "file" too), or { action: "withdraw" }.
 *
 * @auth landlord (own requests only)
 */
export async function POST(req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { data: user } = await supabase.from("users").select("id, name, email").eq("id", session.user.id).maybeSingle();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const input = await readChangeRequestBody(req);
    let request;
    if (input.action === "reply") {
      request = await replyAsLandlord(supabase, {
        user,
        requestId: id,
        body: input.body,
        proposedText: input.proposedText,
        file: input.file,
        storeFile: storeChangeFile,
        notify: changeRequestNotify(),
      });
    } else if (input.action === "withdraw") {
      request = await withdrawRequest(supabase, { user, requestId: id });
    } else {
      throw new BillingError("bad_action", "Choose reply or withdraw.");
    }
    return NextResponse.json({ request: { id: request.id, status: request.status } });
  } catch (err) {
    return billingErrorResponse(err, "update change request");
  }
}
