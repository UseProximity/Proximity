import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

export async function GET() {
  const fixedUserId = "68877696221d6bb66c4c7c7d"; // For now fixed User
  try {
    await connectMongo();

    const user = await User.findById(fixedUserId)
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
      owner: l.owner?.toString?.() || null, // owner is an ObjectId here
      latitude: l.latitude,
      longitude: l.longitude,
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
    }));
    const favoritesIds = safeFavorites.map((f) => f._id);

    // Optional: flat list for dashboard cards
    const favoriteListings =
      safeFavorites.map((f) => ({
        id: f._id,
        name: f.address, // no "name" in schema; use address for display
        address: f.address,
        rent: f.rent,
        image: f.images?.[0] || "",
      })) || [];

    const safeUser = {
      ...user,
      _id: user._id.toString(),
      favorites: safeFavorites, // populated and serialized
      favoritesIds, // keep a simple ids array for quick membership checks
      favoriteListings, // convenient shape for dashboard UI
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,
    };

    return Response.json(safeUser);
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
}
