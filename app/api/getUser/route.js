export const dynamic = "force-dynamic"; //so Next knows it's dynamic and not static

import { auth } from "@/auth";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectMongo();

    // Try by id first, fall back to email lookup (handles adapter ID format mismatches)
    let user = null;
    try {
      user = await User.findById(session.user.id)
        .populate("favorites")
        .populate("listings")
        .populate("contacted")
        .lean();
    } catch (_) {
      // id may not be a valid ObjectId in some adapter configs
    }

    if (!user && session.user.email) {
      user = await User.findOne({ email: session.user.email })
        .populate("favorites")
        .populate("listings")
        .populate("contacted")
        .lean();
    }

    // If we still have no Mongoose record, return the session data so the UI
    // at least renders the user's name/image/email.
    if (!user) {
      return Response.json({
        _id: session.user.id ?? null,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        favorites: [],
        listings: [],
        contacted: [],
        favoritesIds: [],
        listingsIds: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    // Serialize populated favorites
    const safeFavorites = (user.favorites || []).map((l) => ({
      _id: l._id?.toString(),
      address: l.address,
      unitTypes: Array.isArray(l.unitTypes) ? l.unitTypes : [],
      leaseType: l.leaseType,
      images: Array.isArray(l.images) ? l.images : [],
      rating: l.rating ?? 0,
      numReviews: l.numReviews ?? 0,
      owner: l.owner?.toString?.() || null,
      latitude: l.latitude,
      longitude: l.longitude,
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
    }));
    const favoritesIds = safeFavorites.map((f) => f._id);

    // Serialize populated listings
    const safeListings = (user.listings || []).map((l) => ({
      _id: l._id?.toString(),
      address: l.address,
      unitTypes: Array.isArray(l.unitTypes) ? l.unitTypes : [],
      leaseType: l.leaseType,
      images: Array.isArray(l.images) ? l.images : [],
      rating: l.rating ?? 0,
      numReviews: l.numReviews ?? 0,
      owner: l.owner?.toString?.() || null,
      latitude: l.latitude,
      longitude: l.longitude,
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
    }));
    const listingsIds = safeListings.map((l) => l._id);

    const safeContacted = (user.contacted || []).map((l) => ({
      _id: l._id?.toString(),
      address: l.address,
      unitTypes: Array.isArray(l.unitTypes) ? l.unitTypes : [],
      leaseType: l.leaseType,
      images: Array.isArray(l.images) ? l.images : [],
      rating: l.rating ?? 0,
      numReviews: l.numReviews ?? 0,
      owner: l.owner?.toString?.() || null,
      latitude: l.latitude,
      longitude: l.longitude,
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
    }));

    const safeUser = {
      ...user,
      _id: user._id.toString(),
      favorites: safeFavorites,
      favoritesIds,
      listings: safeListings,
      listingsIds,
      contacted: safeContacted,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,
    };

    return Response.json(safeUser, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
