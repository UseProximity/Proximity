import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import { auth } from "@/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReviewsSection from "@/components/ReviewsSection";

export default async function Landlord({ params }) {
  const { landlordId } = params;
  const session = await auth();

  await connectMongo();

  // Need to sanitize the data before to fix: RangeError: Maximum call stack size exceeded.
  const landlordDoc = await User.findById(decodeURIComponent(landlordId))
    .populate({
      path: "listings",
      // select fields you actually need to reduce payload
      select: "address images rent bedrooms bathrooms area leaseType createdAt",
    })
    .populate({
      path: "reviews",
      populate: {
        path: "reviewer",
        select: "name image",
      },
      select: "rating comment legitimacy reviewer createdAt",
    })
    .lean(); // <-- IMPORTANT: returns plain JS objects (no mongoose doc)

  if (!landlordDoc) notFound();

  // sanitize: convert ObjectIds/dates to strings and keep only what you need
  const landlord = {
    ...landlordDoc,
    _id: String(landlordDoc._id),
    listings: (landlordDoc.listings || []).map((l) => ({
      ...l,
      _id: String(l._id),
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
    })),
    reviews: (landlordDoc.reviews || []).map((r) => ({
      _id: String(r._id),
      rating: r.rating,
      comment: r.comment,
      legitimacy: r.legitimacy,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      reviewer: r.reviewer
        ? { name: r.reviewer.name, image: r.reviewer.image || null }
        : null,
    })),
  };

  const leaseTypeMap = {
    sublease: "Sub-Lease",
    nine: "9 Month Lease",
    twelve: "12 Month Lease",
    academic: "Academic Year",
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/*Landlord Recap */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{landlord.name}</h1>
            <div className="text-yellow-500 text-lg">
              {"★".repeat(landlord.rating)}
              <span className="text-gray-300">
                {"★".repeat(5 - landlord.rating)}
              </span>
            </div>
            <p className="text-gray-500">
              {landlord.listings.length} active listings
            </p>
            <p className="text-gray-600 text-sm mt-1">{landlord.description}</p>
            <p className="text-gray-400 text-sm">
              {landlord.age} years old • {landlord.gender}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              📞 {landlord.phone} • ✉️ {landlord.email}
            </p>
          </div>
          <img
            src={landlord.image}
            alt={landlord.name}
            className="w-20 h-20 rounded-full object-cover"
          />
        </div>

        {/* Main Content: Reviews (Left) + Listings (Right) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Reviews */}
          <ReviewsSection
            reviews={landlord.reviews}
            session={session}
            landlordName={landlord.name}
            reviewedId={landlord._id}
          />

          {/* Listings */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Listings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {landlord.listings.map((listing, index) => (
                <Link
                  key={index}
                  href={`/browse/${encodeURIComponent(listing._id)}`} //FIX-ME this href doenst work anymore because of the modals
                >
                  <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    <img
                      src={listing.images[0]}
                      alt={listing.address}
                      className="w-full h-40 object-cover"
                    />
                    <div className="p-4">
                      <h3 className="text-lg font-semibold">${listing.rent}</h3>
                      <p className="text-gray-500">{listing.address}</p>
                      <p className="text-sm text-gray-400">
                        {listing.bedrooms} Beds • {listing.bathrooms} Baths •{" "}
                        {listing.area.toLocaleString()} Sq Ft
                      </p>
                      <p className="text-xs text-gray-400">
                        {leaseTypeMap[listing.leaseType] || listing.leaseType}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
