import { Header } from "@/components/Header";
import AvailableListings from "@/components/AvailableListings";
import Listing from "@/models/Listing";
import connectMongo from "@/libs/mongoose";

export default async function Browse() {
  await connectMongo();

  // Fetch plain objects using lean()
  const listings = await Listing.find().lean();

  // Convert non-serializable fields (ObjectId, Date, etc.)
  const safeListings = listings.map((listing) => ({
    ...listing,
    _id: listing._id.toString(),
    owner: listing.owner?.toString() || null,
    createdAt: listing.createdAt?.toISOString() || null,
    updatedAt: listing.updatedAt?.toISOString() || null,
  }));
  return (
    <>
      <Header />

      <div className="min-h-screen bg-gray-50">
        <div className="flex flex-col md:flex-row h-screen">
          <AvailableListings listings={safeListings} />
        </div>
      </div>
    </>
  );
}
