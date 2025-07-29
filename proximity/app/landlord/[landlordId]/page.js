import { Header } from "@/components/Header";
import connectMongo from "@/libs/mongoose";
import Listing from "@/models/Listing";
import User from "@/models/User";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function Landlord({ params }) {
  const { landlordId } = params;

  await connectMongo();

  const landlord = await User.findById(decodeURIComponent(landlordId));

  if (!landlord) notFound();

  const landlordListings = await Listing.find({ owner: landlord._id });

  const reviews = [
    {
      name: "Emily R.",
      rating: 5,
      comment:
        "Loved living here! The landlord was very responsive and the neighborhood felt safe and quiet. Highly recommend.",
    },
    {
      name: "Jake T.",
      rating: 1,
      comment: "Shit Place.",
    },
    {
      name: "Sophia L.",
      rating: 4,
      comment:
        "Great place for students, close to everything. A few minor repairs needed during my stay, but they were fixed quickly.",
    },
  ];

  const leaseTypeMap = {
    sublease: "Sub-Lease",
    nine: "9 Month Lease",
    twelve: "12 Month Lease",
    academic: "Academic Year",
  };

  return (
    <>
      <Header />
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
              {landlordListings.length} active listings
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
          <div className="md:col-span-1 bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">
              Reviews For {landlord.name}
            </h2>
            <div className="space-y-4">
              {reviews.map((review, index) => (
                <div key={index} className="border-b pb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {review.name}
                    </span>
                    <span className="text-yellow-500">
                      {"★".repeat(review.rating)}
                      <span className="text-gray-300">
                        {"★".repeat(5 - review.rating)}
                      </span>
                    </span>
                  </div>
                  <p className="text-gray-700 mt-1">{review.comment}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Listings */}
          <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Listings</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {landlordListings.map((listing, index) => (
                <Link
                  key={index}
                  href={`/browse/${encodeURIComponent(listing._id)}`}
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
