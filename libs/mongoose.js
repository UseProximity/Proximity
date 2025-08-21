import mongoose from "mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";
import Review from "@/models/Review";

/*
const connectMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (e) {
    console.error("Mongoose Error: " + e.message);
  }
};

export default connectMongo;
*/
// Replace with a more robust connection handler to avoid multiple connections and reuse the same connection
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGODB_URI) {
  throw new Error("Missing MONGODB_URI (or MONGO_URI) env var");
}

// Global cache (works across hot reloads in dev)
let cached = global._mongoose;
if (!cached) {
  cached = global._mongoose = { conn: null, promise: null };
}

export default async function connectMongo() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI, {
        bufferCommands: false,
        maxPoolSize: 10,
      })
      .then((m) => m)
      .catch((err) => {
        cached.promise = null;
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}
