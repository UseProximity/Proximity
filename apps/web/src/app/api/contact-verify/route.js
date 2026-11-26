import { NextResponse } from "next/server";
import { confirmContactVerification } from "@/lib/chat/contactVerification";

/*
 * Redeem a per-listing alert address confirmation link. Possession of the link,
 * which was emailed to the address, is the proof; no session is involved.
 *
 * @auth public
 */
export async function POST(req) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const result = await confirmContactVerification(token);
  if (!result) {
    return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
