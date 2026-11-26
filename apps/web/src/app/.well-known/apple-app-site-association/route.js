import { NextResponse } from "next/server";
import { authPathsEnabled, buildAasa } from "@/lib/appLinks/aasa";

// Read at request time so the flag is never frozen in at build time.
export const dynamic = "force-dynamic";

// Served as JSON with no redirect, as Apple requires for this file.
export function GET() {
  return NextResponse.json(buildAasa({ authPaths: authPathsEnabled() }), {
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
