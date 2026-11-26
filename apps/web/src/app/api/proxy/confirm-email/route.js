/*
 * GET /api/proxy/confirm-email?t=<token>: the link in Proxy's "confirm your
 * email" message (lib/agents/visitorEmail.js). Confirms the address for that
 * conversation and sends the visitor back to the listing's Contact tab.
 *
 * @auth public (the one-time token is the authorization)
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { confirmVisitorEmail } from "@/lib/agents/visitorEmail";
import { agentsEnabled } from "@/lib/agents/flags";
import { getBaseUrl } from "@/lib/email";

export async function GET(req) {
  const base = getBaseUrl();
  if (!agentsEnabled()) return NextResponse.redirect(`${base}/`);
  try {
    const token = new URL(req.url).searchParams.get("t");
    const r = await confirmVisitorEmail(token);
    if (!r) return NextResponse.redirect(`${base}/?emailConfirm=expired`);
    return NextResponse.redirect(`${base}/listings/${r.listingId}?listingTab=contact&emailConfirm=${r.existingAccount ? "account" : "ok"}`);
  } catch (err) {
    console.error("[proxy] confirm email failed:", err?.message ?? err);
    return NextResponse.redirect(`${base}/?emailConfirm=error`);
  }
}
