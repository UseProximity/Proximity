import { Header } from "@/components/Header";
import Link from "next/link";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";

export default async function LandlordDashboard() {
  const defaultUserId = "68860dbc15d884a2dc96b79c";
  await connectMongo();
  const defaultLandlord = await User.findById(defaultUserId);

  const landlordListings = await Listing.find({ owner: defaultLandlord._id });

  const leaseTypeMap = {
    sublease: "Sub-Lease",
    nine: "9 Month Lease",
    twelve: "12 Month Lease",
    academic: "Academic Year",
  };

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto p-6 mt-10 space-y-6">
        {/* Editable Profile Card */}
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{defaultLandlord.name}</h1>
            <p className="text-gray-600 text-sm mt-1">
              {defaultLandlord.description}
            </p>
            <p className="text-gray-400 text-sm">
              {defaultLandlord.age} years old • {defaultLandlord.gender}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              📞 {defaultLandlord.phone} • ✉️ {defaultLandlord.email}
            </p>
            <button className="mt-3 px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600">
              Edit Profile
            </button>
          </div>
          <img
            src={defaultLandlord.image}
            alt={defaultLandlord.name}
            className="w-20 h-20 rounded-full object-cover"
          />
        </div>

        {/* Reputation Card (Read-Only) */}
        <div className="bg-gray-50 p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Your Reputation
          </h2>
          <div className="text-yellow-500 text-lg">
            {"★".repeat(defaultLandlord.rating)}
            <span className="text-gray-300">
              {"★".repeat(5 - defaultLandlord.rating)}
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            {landlordListings.length} active listings
          </p>
        </div>

        {/* Dashboard Section */}
        <h1 className="text-3xl font-bold text-red-600">Landlord Dashboard</h1>
        <p className="text-gray-700">
          Welcome, landlord! Here you can manage your listings.
        </p>

        <div className="space-y-4">
          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">
              Your Listings
            </h2>
            {landlordListings.length == 0 ? (
              <p className="text-gray-500">
                This is where you would see your posted properties.
              </p>
            ) : (
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
                        <h3 className="text-lg font-semibold">
                          ${listing.rent}
                        </h3>
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
            )}
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">
              Reviews About You
            </h2>
            <p className="text-gray-500">
              This is where you would see reviews about you
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
