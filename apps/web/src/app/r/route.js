/*
 * The QR code's destination: /r?src=<tag> → /review?src=<tag>.
 *
 * Two reasons a printed code points here rather than straight at /review. A
 * shorter URL encodes as a lower-density QR, which scans faster from further
 * away and survives a cheap print; and the redirect is a layer of indirection we
 * control, so where a code already stapled to a hundred flyers leads can still
 * be changed later.
 *
 * Any query string is carried through, so the campaign tag survives the hop.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(req) {
  const { search } = new URL(req.url);
  return NextResponse.redirect(new URL(`/review${search}`, req.url), 307);
}
