/*
 * The short campaign link: /go/<slug> -> <destination>?src=<slug>.
 *
 * Used for QR codes and anywhere length matters (PRD 7.9). The destination is
 * read on every visit, so a printed code can be repointed by editing the link.
 * Any other query string is carried through, the same way /r works.
 *
 * An unknown or deleted slug goes to the home page but keeps ?src=<slug>, so
 * the session beacon still records the visit as qr / <slug> and it shows up
 * under unregistered tags instead of being lost. Archived links still follow
 * their destination.
 *
 * 307 (temporary) so browsers never cache an old destination. Nothing is
 * recorded here: the browser beacon on the landing page does that, so bots
 * that follow the redirect without running JavaScript make no session.
 */
import { NextResponse } from "next/server";
import { goRedirectPath } from "@/lib/marketing/links";
import { findLinkDestination } from "@/lib/marketing/sessions";
import { normalizeTag } from "@/lib/marketing/tags";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { slug: raw } = await params;
  const slug = normalizeTag(decodeURIComponent(raw || ""));
  const { search } = new URL(req.url);
  if (!slug) return NextResponse.redirect(new URL("/", req.url), 307);

  let link = null;
  try {
    link = await findLinkDestination(slug);
  } catch (err) {
    console.error("/go lookup failed:", err?.message || err);
  }
  return NextResponse.redirect(new URL(goRedirectPath(link, slug, search), req.url), 307);
}
