import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseClient } from "@/libs/supabase";

// Maps every known non-canonical value → canonical snake_case
const NORMALIZE = {
  // ALL_CAPS with hyphen
  "DISHWASHER":      "dishwasher",
  "IN-UNIT LAUNDRY": "in_unit_laundry",
  "MAILROOM":        "mailroom",
  "PETS ALLOWED":    "pets_allowed",
  "EXTRA STORAGE":   "extra_storage",
  "FIREPLACE":       "fireplace",
  "FREE PARKING":    "private_parking",
  "POOL":            "pool",
  "STUDY ROOMS":     "study_room",
  "GYM":             "gym",
  "FURNISHED":       "furnished",
  // ALL_CAPS without hyphen (seen in real data)
  "IN UNIT LAUNDRY": "in_unit_laundry",
  "PETS_ALLOWED":    "pets_allowed",
  "EXTRA_STORAGE":   "extra_storage",
  "FREE_PARKING":    "private_parking",
  "STUDY_ROOMS":     "study_room",
  "PRIVATE PARKING": "private_parking",
  "PRIVATE_PARKING": "private_parking",
};

export async function POST(req) {
  const session = await auth();
  if (!session || session.user.role !== "super") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dbTarget = req.headers.get("x-db-target");
  const supabase = getSupabaseClient(dbTarget === "prod" || dbTarget === "dev" ? dbTarget : undefined);

  const { data: listings, error } = await supabase
    .from("listings")
    .select("id, amenities")
    .not("amenities", "eq", "{}");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let migrated = 0;
  let unchanged = 0;
  const unknown = new Set();

  for (const listing of listings || []) {
    const original = listing.amenities || [];
    const normalized = original.map((v) => {
      if (NORMALIZE[v]) return NORMALIZE[v];
      // Already canonical or unknown — keep as-is but track unknowns
      if (!/^[a-z_]+$/.test(v)) unknown.add(v);
      return v;
    });

    const changed = normalized.some((v, i) => v !== original[i]);
    if (!changed) { unchanged++; continue; }

    const { error: updateError } = await supabase
      .from("listings")
      .update({ amenities: normalized })
      .eq("id", listing.id);

    if (updateError) {
      console.error("Error updating listing amenities:", updateError.message);
    } else {
      migrated++;
    }
  }

  return NextResponse.json({
    total: (listings || []).length,
    migrated,
    unchanged,
    unknownValues: [...unknown],
  });
}
