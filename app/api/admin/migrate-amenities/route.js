import { NextResponse } from "next/server";
import { auth } from "@/auth";
import mongoose from "mongoose";
import connectMongo from "@/libs/mongoose";
import Listing from "@/models/Listing";

async function getListingModel(db) {
  if (!db || db === "default") {
    await connectMongo();
    return Listing;
  }
  const uri = db === "dev" ? process.env.MONGO_URI_DEV : process.env.MONGO_URI_PROD;
  if (!uri) return null;
  const cacheKey = `_mongooseAdmin_${db}`;
  if (!global[cacheKey] || global[cacheKey].readyState === 0) {
    global[cacheKey] = mongoose.createConnection(uri, { bufferCommands: false, maxPoolSize: 5 });
    await global[cacheKey].asPromise();
  }
  const conn = global[cacheKey];
  return conn.models["Listing"] || conn.model("Listing", Listing.schema);
}

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

  const db = new URL(req.url).searchParams.get("db") || "default";
  const ListingModel = await getListingModel(db);
  if (!ListingModel) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

  const listings = await ListingModel.find({
    amenities: { $exists: true, $not: { $size: 0 } },
  }).select("_id amenities").lean();

  let migrated = 0;
  let unchanged = 0;
  const unknown = new Set();

  for (const listing of listings) {
    const original = listing.amenities || [];
    const normalized = original.map((v) => {
      if (NORMALIZE[v]) return NORMALIZE[v];
      // Already canonical or unknown — keep as-is but track unknowns
      if (!/^[a-z_]+$/.test(v)) unknown.add(v);
      return v;
    });

    const changed = normalized.some((v, i) => v !== original[i]);
    if (!changed) { unchanged++; continue; }

    await ListingModel.findByIdAndUpdate(
      listing._id,
      { $set: { amenities: normalized } },
      { strict: false }
    );
    migrated++;
  }

  return NextResponse.json({
    total: listings.length,
    migrated,
    unchanged,
    unknownValues: [...unknown],
  });
}
