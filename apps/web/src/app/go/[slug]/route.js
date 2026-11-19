/*
 * Placeholder for the campaign short link: /go/<slug> -> /?src=<slug>.
 *
 * A QR code has to be printed before the marketing attribution PR (#456)
 * lands. That PR adds this same route backed by registered campaign links,
 * whose destination can be changed in the admin panel. Until then every slug
 * goes to the home page with ?src=<slug>, which is exactly what #456 does for
 * a slug that isn't registered, so a code printed now behaves the same before
 * and after it merges. When #456 merges, its version of this file replaces
 * this one.
 *
 * Any other query string is carried through, the same way /r works. 307
 * (temporary) so browsers never cache this destination once it can change.
 */
import { NextResponse } from "next/server";
import { normalizeReviewSource } from "@/lib/reviews/source";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { slug: raw } = await params;
  let decoded = raw || "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // A malformed escape like %E0 would throw; clean the raw text instead.
  }
  const slug = normalizeReviewSource(decoded);
  const incoming = new URL(req.url).searchParams;
  const dest = new URL("/", req.url);
  for (const [k, v] of incoming) {
    if (k !== "src") dest.searchParams.set(k, v);
  }
  if (slug) dest.searchParams.set("src", slug);
  return NextResponse.redirect(dest, 307);
}
