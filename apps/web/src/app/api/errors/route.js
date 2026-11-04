/*
 * POST /api/errors: a visitor's browser reporting that something broke on a
 * page (components/ErrorReporter.js and the error screens), for the site
 * error alerts (lib/errors/record.js, Wyatt, 2026-11-03).
 *
 * Open to anyone, since crashes happen signed out too, so it is kept narrow:
 * same-site requests only, a small body, a per-visitor rate limit, and only
 * the fields below are kept. No cookies, form contents or page text are
 * stored; the page path is kept without its query string.
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { recordError } from "@/lib/errors/record";

const MAX_BODY = 16000;
const PER_MINUTE = 10;
const hits = new Map(); // ip -> recent timestamps

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > PER_MINUTE;
}

function sameSite(req) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

export async function POST(req) {
  try {
    if (!sameSite(req)) return new NextResponse(null, { status: 204 });
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (limited(ip)) return new NextResponse(null, { status: 204 });
    const raw = await req.text();
    if (raw.length > MAX_BODY) return new NextResponse(null, { status: 204 });
    const body = JSON.parse(raw || "{}");
    const message = str(body.message, 2000);
    if (!message) return new NextResponse(null, { status: 204 });
    const path = str(body.path, 300)?.split("?")[0] ?? null;
    const session = await auth().catch(() => null);
    after(() => recordError({
      source: "browser",
      where: path ? `Page ${path}` : "Page",
      message,
      stack: str(body.stack, 8000),
      sample: {
        url: path,
        kind: str(body.kind, 40),
        role: session?.user?.role ?? "signed out",
        userAgent: str(req.headers.get("user-agent"), 200),
      },
    }));
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
