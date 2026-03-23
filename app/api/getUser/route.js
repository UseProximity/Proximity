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

    const user = await User.findById(session.user.id)
      .populate("favorites")
      .populate("listings")
      .lean();

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    // Serialize populated favorites
    const safeFavorites = (user.favorites || []).map((l) => ({
      _id: l._id?.toString(),
      address: l.address,
      unitTypes: Array.isArray(l.unitTypes) ? l.unitTypes : [],
      leaseType: l.leaseType,
      leaseTerm: l.leaseTerm,
      moveInDate: l.moveInDate ? new Date(l.moveInDate).toISOString() : null,
      homeType: l.homeType,
      amenities: Array.isArray(l.amenities) ? l.amenities : [],
      furnished: l.furnished,
      utilitiesIncluded: l.utilitiesIncluded ?? false,
      subleaseFriendly: l.subleaseFriendly ?? false,
      distanceToCampusKm: l.distanceToCampusKm,
      minRent: l.minRent,
      maxRent: l.maxRent,
      minBathrooms: l.minBathrooms,
      maxBathrooms: l.maxBathrooms,
      minBedrooms: l.minBedrooms,
      maxBedrooms: l.maxBedrooms,
      minArea: l.minArea,
      maxArea: l.maxArea,
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
      leaseTerm: l.leaseTerm,
      moveInDate: l.moveInDate ? new Date(l.moveInDate).toISOString() : null,
      homeType: l.homeType,
      amenities: Array.isArray(l.amenities) ? l.amenities : [],
      furnished: l.furnished,
      utilitiesIncluded: l.utilitiesIncluded ?? false,
      subleaseFriendly: l.subleaseFriendly ?? false,
      distanceToCampusKm: l.distanceToCampusKm,
      minRent: l.minRent,
      maxRent: l.maxRent,
      minBathrooms: l.minBathrooms,
      maxBathrooms: l.maxBathrooms,
      minBedrooms: l.minBedrooms,
      maxBedrooms: l.maxBedrooms,
      minArea: l.minArea,
      maxArea: l.maxArea,
      images: Array.isArray(l.images) ? l.images : [],
      rating: l.rating ?? 0,
      numReviews: l.numReviews ?? 0,
      owner: l.owner?.toString?.() || null,
      latitude: l.latitude,
      longitude: l.longitude,
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
    }));
    const listingsIds = safeListings.map((l) => l._id);

    const safeUser = {
      ...user,
      _id: user._id.toString(),
      favorites: safeFavorites,
      favoritesIds,
      listings: safeListings,
      listingsIds,
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
