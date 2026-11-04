export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import { attachmentFor } from "@/lib/billing/changeRequests";
import { changeFileUrl } from "@/lib/billing/changeRequestFiles";
import { billingErrorResponse, isUuid } from "@/lib/billing/http";

/*
 * A five minute download link for a file attached to one of the landlord's own
 * change requests (theirs or one the team attached).
 *
 * @auth landlord (own requests only)
 */
export async function GET(_req, { params }) {
  const session = await requireDbRole(["landlord"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { messageId } = await params;
  if (!isUuid(messageId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const file = await attachmentFor(supabase, { messageId, viewerId: session.user.id });
    return NextResponse.json({ url: await changeFileUrl(file.key, file.fileName) });
  } catch (err) {
    return billingErrorResponse(err, "open change request file");
  }
}
