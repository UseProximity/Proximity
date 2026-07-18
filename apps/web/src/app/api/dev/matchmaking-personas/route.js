/*
 * Custom-persona matchmaking runner — DEV-ONLY (returns 403 in production).
 *
 *   POST /api/dev/matchmaking-personas   body: { personas: [{ label, prefs }] }
 *
 * Runs each supplied COMPLETED preferences object through the EXACT production
 * ranking path (recomputeFromPreferences -> computeRecommendations) and returns
 * its top-3 picks + derived weights. Mirrors /api/dev/matchmaking-probe but takes
 * the personas from the request body, so a script can replay real student
 * profiles (e.g. the matchmaking CSV export) against the live algorithm.
 */
import { NextResponse } from "next/server";
import { recomputeFromPreferences } from "@/lib/matchmaking/questionEngine";
import { computeRecommendations } from "@/lib/matchmaking/chatOrchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const personas = Array.isArray(body?.personas) ? body.personas : [];
  if (!personas.length) return Response.json({ error: "No personas supplied" }, { status: 400 });

  const results = [];
  for (const p of personas) {
    const { preferences, weights } = recomputeFromPreferences(p.prefs ?? {});
    let top3 = [];
    let err = null;
    try {
      top3 = await computeRecommendations(preferences, weights);
    } catch (e) {
      err = String(e?.message ?? e);
    }
    results.push({
      label: p.label,
      budget_max: preferences.budget_max ?? null,
      group_size: preferences.group_size ?? null,
      area: preferences.area ?? null,
      proximity_targets: preferences.proximity_targets ?? null,
      topWeights: Object.entries(weights)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${k}:${v.toFixed(2)}`),
      error: err,
      picks: (top3 ?? []).map((r) => ({
        listing_id: r.listing_id,
        title: r.card_data?.title ?? null,
        intention: r.intention,
        score: r.score,
        per_person: r.card_data?.min_rent ?? null,
        reason: r.reason,
      })),
    });
  }
  return NextResponse.json({ generatedAt: new Date().toISOString(), personaCount: personas.length, results });
}
