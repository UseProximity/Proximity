export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import mongoose from "mongoose";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";
import Review from "@/models/Review";
import Dorm from "@/models/Dorm";
import DormReview from "@/models/DormReview";
import Testimonial from "@/models/Testimonial";

// Base model definitions — used for both the default connection and named DB connections
const MODEL_DEFS = {
  users:        { name: "User",        model: User        },
  listings:     { name: "Listing",     model: Listing     },
  reviews:      { name: "Review",      model: Review      },
  dorms:        { name: "Dorm",        model: Dorm        },
  dormreviews:  { name: "DormReview",  model: DormReview  },
  testimonials: { name: "Testimonial", model: Testimonial },
};

async function requireSuper() {
  const session = await auth();
  if (!session || session.user.role !== "super") return null;
  return session;
}

// Returns a Mongoose model bound to the requested DB connection.
// "default" (or no param) uses the shared connectMongo connection.
// "dev" uses MONGO_URI_DEV, "prod" uses MONGO_URI_PROD.
async function getModel(table, db) {
  const def = MODEL_DEFS[table.toLowerCase()];
  if (!def) return null;

  if (!db || db === "default") {
    await connectMongo();
    return def.model;
  }

  const uri = db === "dev" ? process.env.MONGO_URI_DEV : process.env.MONGO_URI_PROD;
  if (!uri) return null;

  // Cache a separate connection per db label
  const cacheKey = `_mongooseAdmin_${db}`;
  if (!global[cacheKey] || global[cacheKey].readyState === 0) {
    global[cacheKey] = mongoose.createConnection(uri, {
      bufferCommands: false,
      maxPoolSize: 5,
    });
    await global[cacheKey].asPromise();
  }
  const conn = global[cacheKey];

  // Re-use or register the model on this connection
  return conn.models[def.name] || conn.model(def.name, def.model.schema);
}

export async function GET(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;
  const db = new URL(req.url).searchParams.get("db") || "default";
  const Model = await getModel(table, db);
  if (!Model) return Response.json({ error: "Unknown table or DB not configured" }, { status: 404 });

  const rows = await Model.find({}).lean().limit(1000);
  return Response.json(JSON.parse(JSON.stringify(rows)));
}

export async function PATCH(req, { params }) {
  const session = await requireSuper();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { table } = await params;
  const db = new URL(req.url).searchParams.get("db") || "default";
  const Model = await getModel(table, db);
  if (!Model) return Response.json({ error: "Unknown table or DB not configured" }, { status: 404 });

  const body = await req.json();
  const { id, updates } = body;
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  if (!mongoose.Types.ObjectId.isValid(id)) return Response.json({ error: "Invalid id" }, { status: 400 });

  // Strip immutable fields
  const { _id, __v, createdAt, updatedAt, ...safeUpdates } = updates || {};

  const updated = await Model.findByIdAndUpdate(
    id,
    { $set: safeUpdates },
    { new: true, lean: true, strict: false }
  );

  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(JSON.parse(JSON.stringify(updated)));
}
