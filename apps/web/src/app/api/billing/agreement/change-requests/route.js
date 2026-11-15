export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { billingReader } from "@/lib/billing/viewer";
import { createChangeRequest, listMyRequests } from "@/lib/billing/changeRequests";
import { storeChangeFile } from "@/lib/billing/changeRequestFiles";
import { changeRequestNotify } from "@/lib/billing/changeRequestNotify";
import { readChangeRequestBody, optionalId } from "@/lib/billing/changeRequestHttp";
import { BillingError } from "@/lib/billing/errors";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A landlord's requests to change the commission agreement.
 *
 * GET   their requests, newest first, each with its thread
 * POST  open one. JSON or multipart/form-data (with an optional PDF or Word file in
 *       "file"): documentKind ("master" | "amendment"), section, body (what and
 *       why, required), proposedText, and optionally agreementId, amendmentId,
 *       versionId naming the document they were looking at (must be theirs).
 *       409 if they already have one in progress.
 *
 * @auth landlord (own requests only)
 */
async function currentLandlord() {
  const session = await requireDbRole(["landlord"]);
  if (!session) return null;
  const { data } = await supabase.from("users").select("id, name, email").eq("id", session.user.id).maybeSingle();
  return data;
}

export async function GET(req) {
  const reader = await billingReader(req);
  if (!reader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ requests: await listMyRequests(supabase, reader.userId) });
  } catch (err) {
    return billingErrorResponse(err, "list change requests");
  }
}

export async function POST(req) {
  const user = await currentLandlord();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const input = await readChangeRequestBody(req);
    const ids = {
      agreementId: optionalId(input.agreementId, isUuid),
      amendmentId: optionalId(input.amendmentId, isUuid),
      versionId: optionalId(input.versionId, isUuid),
    };
    if (Object.values(ids).includes(undefined)) throw new BillingError("bad_document", "That document was not found.", 404);
    const request = await createChangeRequest(supabase, {
      user,
      documentKind: input.documentKind,
      ...ids,
      section: input.section,
      body: input.body,
      proposedText: input.proposedText,
      file: input.file,
      storeFile: storeChangeFile,
      notify: changeRequestNotify(),
    });
    return NextResponse.json({ request }, { status: 201 });
  } catch (err) {
    return billingErrorResponse(err, "open change request");
  }
}
