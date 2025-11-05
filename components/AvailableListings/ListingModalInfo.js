import Link from "next/link";
import ConditionalButtons from "@/components/ConditionalButtons";

// Static Data
const leaseTypeMap = {
  sublease: "Sub-Lease",
  nine: "9 Month Lease",
  twelve: "12 Month Lease",
  academic: "Academic Year",
};

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

export default function ListingModalInfo({ HeartIcon, user, listing }) {
  return (
    <>
      <div className="bg-gray-100 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Image + Gallery */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="relative md:col-span-2">
              <img
                src={listing.images[0]}
                alt={listing.address}
                className="rounded-xl w-full h-[400px] object-cover shadow"
              />
              <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
              <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50">
                <HeartIcon
                  userId={user?._id || ""}
                  listingId={listing._id}
                  initial={
                    Boolean(user) &&
                    Boolean(
                      user?.favorites?.some(
                        (f) => String((f && f._id) || f) === String(listing._id)
                      ) || user?.favoritesIds?.includes(String(listing._id))
                    )
                  }
                />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-3 bg-white p-6 rounded-xl shadow-md">
              <div className="flex justify-between items-center">
                <div className="text-3xl font-bold text-gray-900">
                  ${listing.rent}
                </div>
              </div>
              <div className="text-gray-700">{listing.address}</div>
              <div className="text-sm text-gray-500">
                Listed by <strong>{listing.owner.name}</strong>
              </div>

              {/*Landlord profile and Rating Thing */}
              <Link href={`/landlord/${encodeURIComponent(listing.owner._id)}`}>
                {/**FIX-ME make the url unique for each landlord (not using the name) */}
                <div className="flex items-center gap-2 mt-1">
                  <img
                    src={listing.owner.image}
                    alt={listing.owner.name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div>
                    <div className="text-yellow-500 text-sm leading-tight">
                      {"★".repeat(listing.owner.rating)}
                      <span className="text-gray-300">
                        {"★".repeat(5 - listing.owner.rating)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">Landlord Rating</p>
                  </div>
                </div>
              </Link>

              <ConditionalButtons listing={listing} />
            </div>
          </div>

          {/* Specs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">{listing.bedrooms}</div>
              <div className="text-sm text-gray-500">Beds</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">{listing.bathrooms}</div>
              <div className="text-sm text-gray-500">Baths</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {listing.area.toLocaleString()}
              </div>
              <div className="text-sm text-gray-500">Sq Ft</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-lg font-semibold">
                {leaseTypeMap[listing.leaseType] || listing.leaseType}
              </div>
              <div className="text-sm text-gray-500">Lease Type</div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <h2 className="text-xl font-semibold mb-4">Property Overview</h2>
            <p className="text-gray-700 leading-relaxed">
              Welcome to this charming listing located at{" "}
              <strong>{listing.address}</strong>! This beautiful home features{" "}
              {listing.bedrooms} spacious bedrooms and {listing.bathrooms}{" "}
              elegant bathrooms, boasting a total of{" "}
              {listing.area.toLocaleString()} square feet. Perfect for families,
              professionals, or students looking for a spacious and modern place
              to live near campus or the city center.
            </p>
          </div>

          {/* Reviews */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">
              Reviews For The Property
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
        </div>
      </div>
    </>
  );
}
