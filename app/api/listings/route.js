import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";

export async function GET() {
  try {
    await connectMongo();

    // Fetch plain objects using lean(), populate owner name for card display
    const listings = await Listing.find().populate("owner", "name").lean();

    // Convert non-serializable fields (ObjectId, Date, etc.)
    const safeListings = listings.map((listing) => ({
      ...listing,
      _id: listing._id.toString(),
      owner: listing.owner ? { _id: listing.owner._id?.toString(), name: listing.owner.name } : null,
      createdAt: listing.createdAt?.toISOString() || null,
      updatedAt: listing.updatedAt?.toISOString() || null,
    }));

    return Response.json(safeListings);
  } catch (error) {
    console.error("Error fetching listings:", error);
    return Response.json(
      { error: "Failed to fetch listings" },
      { status: 500 }
    );
  }
}
