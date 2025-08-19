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
      .populate({
        path: "favorites",
        select:
          "address rent area bedrooms bathrooms leaseType images rating numReviews owner latitude longitude createdAt",
      })
      .lean();

    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    // Serialize populated favorites
    const safeFavorites = (user.favorites || []).map((l) => ({
      _id: l._id?.toString(),
      address: l.address,
      rent: l.rent,
      area: l.area,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
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

    const favoriteListings =
      safeFavorites.map((f) => ({
        id: f._id,
        name: f.address,
        address: f.address,
        rent: f.rent,
        image: f.images?.[0] || "",
      })) || [];

    const safeUser = {
      ...user,
      _id: user._id.toString(),
      favorites: safeFavorites,
      favoritesIds,
      favoriteListings,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,
    };

    return Response.json(safeUser);
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
