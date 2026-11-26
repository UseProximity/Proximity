/*
 * GET /api/agents/enabled -> { enabled }: whether the per-listing agents are
 * switched on (LISTING_AGENTS_ENABLED), so the browser can keep agent-only UI
 * hidden while the feature ships dark (PR #365 review).
 *
 * @auth public
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { agentsEnabled } from "@/lib/agents/flags";

export async function GET() {
  return NextResponse.json({ enabled: agentsEnabled() });
}
