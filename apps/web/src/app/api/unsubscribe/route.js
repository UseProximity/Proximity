/*
 * Unsubscribe from (or back into) mass email. The token in ?t= names the address,
 * signed by lib/massEmail/unsubscribe.js, so no login is needed.
 *
 *   POST ?t=...                       Gmail / Yahoo one-click (RFC 8058). The body
 *                                     is the form field List-Unsubscribe=One-Click.
 *   POST ?t=...&action=unsubscribe    the /unsubscribe page, on load
 *   POST ?t=...&action=resubscribe    the page's "Resubscribe" button
 *
 * There is no GET on purpose: link scanners and mail previews fetch every URL in
 * an email, and a GET that unsubscribed would remove people who never clicked.
 *
 * @auth public
 */
import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { resubscribe, unsubscribe, verifyUnsubscribeToken } from "@/lib/massEmail/unsubscribe";

export async function POST(req) {
  const url = new URL(req.url);
  const email = verifyUnsubscribeToken(url.searchParams.get("t"));
  if (!email) {
    return NextResponse.json({ error: "This unsubscribe link is not valid." }, { status: 400 });
  }

  const action = url.searchParams.get("action");
  try {
    if (action === "resubscribe") {
      await resubscribe(supabase, email);
    } else {
      await unsubscribe(supabase, email, action === "unsubscribe" ? "link" : "one_click");
    }
  } catch (err) {
    console.error("unsubscribe: write failed:", err?.message ?? err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email, subscribed: action === "resubscribe" });
}
