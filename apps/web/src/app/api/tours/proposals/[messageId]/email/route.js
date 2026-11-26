/*
 * GET  /api/tours/proposals/[messageId]/email?u=<user>&k=<key>  a page with one
 *      Confirm button (opening a link never books anything, so mail scanners
 *      that open links can't)
 * POST the same URL                                           books it
 *
 * The Confirm link in a chat alert email for a suggested tour time (Wyatt,
 * 2026-11-02). The key is an HMAC of the message and its recipient, so it
 * works without signing in and only for that person.
 *
 * @auth public (the key is the authorization)
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import supabase from "@/lib/supabase";
import { getBaseUrl } from "@/lib/email";
import { escapeHtml } from "@/lib/escapeHtml";
import { proposalKey, respondToProposal } from "@/lib/agents/tourProposals";

const page = (title, body) => new NextResponse(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;color:#111827">${body}</body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } },
);

async function check(req, params) {
  const { messageId } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const key = url.searchParams.get("k") ?? "";
  if (!key || key !== proposalKey({ messageId, userId })) return null;
  const { data: msg } = await supabase.from("chat_messages").select("thread_id, metadata").eq("id", messageId).maybeSingle();
  return msg?.metadata?.tourProposal ? { messageId, userId, threadId: msg.thread_id, p: msg.metadata.tourProposal, url } : null;
}

export async function GET(req, { params }) {
  const c = await check(req, params);
  if (!c) return page("Link not valid", "<p>This link is not valid any more. Open the conversation on Proximity to answer.</p>");
  const chat = `${getBaseUrl()}/?messages=1&thread=${c.threadId}`;
  if (c.p.status !== "pending") {
    return page("Already answered", `<p>${c.p.status === "confirmed" ? `Your tour is booked for ${escapeHtml(c.p.text)}.` : "That time is no longer open."}</p><p><a href="${chat}">Open the conversation</a></p>`);
  }
  const verb = c.p.rebook ? "Move your tour to" : "Book your tour for";
  return page("Confirm tour time", `<p style="font-size:18px;font-weight:600">${verb} ${escapeHtml(c.p.text)}?</p>
    <form method="post" action="${escapeHtml(c.url.pathname + c.url.search)}">
      <button type="submit" style="padding:11px 20px;background:#ef4444;color:#fff;border:0;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer">Confirm</button>
    </form>
    <p style="margin-top:20px"><a href="${chat}" style="color:#6b7280">Not now, open the conversation</a></p>`);
}

export async function POST(req, { params }) {
  const c = await check(req, params);
  if (!c) return page("Link not valid", "<p>This link is not valid any more. Open the conversation on Proximity to answer.</p>");
  const r = await respondToProposal({ messageId: c.messageId, userId: c.userId, decision: "confirm" });
  const chat = `${getBaseUrl()}/?messages=1&thread=${c.threadId}`;
  if (r.error) return page("Not booked", `<p>${escapeHtml(r.error)}</p><p><a href="${chat}">Open the conversation</a></p>`);
  return NextResponse.redirect(chat, 303);
}
