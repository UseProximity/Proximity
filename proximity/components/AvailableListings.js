"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import HeartIcon from "./HeartIcon";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function AvailableListings({ listings }) {
  const [price, setPrice] = useState("");
  const [bedBaths, setBedBaths] = useState("");
  const [size, setSize] = useState("");
  const [leaseType, setLeaseType] = useState("");

  const handlePriceChange = (e) => {
    setPrice(e.target.value);
  };

  const handleBedBathsChange = (e) => {
    setBedBaths(e.target.value);
  };

  const handleSizeChange = (e) => {
    setSize(e.target.value);
  };

  const handleLeaseTypeChange = (e) => {
    setLeaseType(e.target.value);
  };

  const handleReset = () => {
    setPrice("");
    setBedBaths("");
    setSize("");
    setLeaseType("");
  };

  // Filtered houses based on selected filters
  const filteredListings = listings.filter((listing) => {
    let matchesPrice = true;
    let matchesBeds = true;
    let matchesSize = true;
    let matchesLease = true;

    // Price filter example (convert to numeric values)
    if (price) {
      const priceNum = parseInt(listing.rent);
      if (price === "Under $1,000") matchesPrice = priceNum < 1000;
      if (price === "$1,000 - $1,500")
        matchesPrice = priceNum >= 1000 && priceNum <= 1500;
      if (price === "$1,500 - $2,000")
        matchesPrice = priceNum >= 1500 && priceNum <= 2000;
      if (price === "Over $2000") matchesPrice = priceNum > 2000;
    }

    // Beds/Baths filter
    if (bedBaths) {
      if (bedBaths === "1 Bed, 1 Bath")
        matchesBeds = listing.bedrooms === 1 && listing.baths === 1;
      if (bedBaths === "2 Bed, 1 Bath")
        matchesBeds = listing.bedrooms === 2 && listing.baths >= 1;
      if (bedBaths === "3 Bed, 2+ Bath")
        matchesBeds = listing.bedrooms === 3 && listing.baths >= 2;
      if (bedBaths === "4+ Bedrooms") matchesBeds = listing.bedrooms >= 4;
    }

    // Size filter
    if (size) {
      if (size === "Under 500 sq ft") matchesSize = listing.area < 500;
      if (size === "500 - 750 sq ft")
        matchesSize = listing.area >= 500 && listing.area <= 750;
      if (size === "750 - 1,000 sq ft")
        matchesSize = listing.area >= 750 && listing.area <= 1000;
      if (size === "1,000 - 1,250 sq ft")
        matchesSize = listing.area >= 1000 && listing.area <= 1250;
      if (size === "1,250 - 1,500 sq ft")
        matchesSize = listing.area >= 1250 && listing.area <= 1500;
      if (size === "Over 1,500 sq ft") matchesSize = listing.area > 1500;
    }

    // Lease Type filter
    if (leaseType) {
      matchesLease =
        (listing.leaseType == "twelve" && leaseType == "12 month lease") ||
        (listing.leaseType == "nine" && leaseType == "9 month lease") ||
        (listing.leaseType == "academic" && leaseType == "Academic Year");
    }

    return matchesPrice && matchesBeds && matchesSize && matchesLease;
  });

  return (
    <>
      {/* Map Section */}
      <div className="md:w-1/2 w-full h-64 md:h-full relative">
        <MapView listings={filteredListings} />
      </div>
      {/* Listings Section */}
      <div className="md:w-1/2 w-full overflow-y-auto px-4 py-8">
        <>
          {/* Filter Controls */}
          <div className="bg-white shadow-md rounded-2xl p-6 mb-8 flex flex-wrap justify-center gap-4">
            {/* Price Filter */}
            <select
              value={price}
              onChange={handlePriceChange}
              className="min-w-[180px] px-4 py-2 rounded-full bg-gray-50 border border-gray-300 shadow-sm text-sm text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              <option value="">Price</option>
              {[
                "Under $1,000",
                "$1,000 - $1,500",
                "$1,500 - $2,000",
                "Over $2000",
              ].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {/* Bed/Baths Filter */}
            <select
              value={bedBaths}
              onChange={handleBedBathsChange}
              className="min-w-[180px] px-4 py-2 rounded-full bg-gray-50 border border-gray-300 shadow-sm text-sm text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              <option value="">Bed/Baths</option>
              {[
                "1 Bed, 1 Bath",
                "2 Bed, 1 Bath",
                "3 Bed, 2+ Bath",
                "4+ Bedrooms",
              ].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {/* Size Filter */}
            <select
              value={size}
              onChange={handleSizeChange}
              className="min-w-[180px] px-4 py-2 rounded-full bg-gray-50 border border-gray-300 shadow-sm text-sm text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              <option value="">Size</option>
              {[
                "Under 500 sq ft",
                "500 - 750 sq ft",
                "750 - 1,000 sq ft",
                "1,000 - 1,250 sq ft",
                "1,250 - 1,500 sq ft",
                "Over 1,500 sq ft",
              ].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {/* Lease Type Filter */}
            <select
              value={leaseType}
              onChange={handleLeaseTypeChange}
              className="min-w-[180px] px-4 py-2 rounded-full bg-gray-50 border border-gray-300 shadow-sm text-sm text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              <option value="">Lease Type</option>
              {["12 month lease", "9 month lease", "Academic Year"].map(
                (option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                )
              )}
            </select>

            {/* Reset Button */}
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-full border border-red-500 text-red-500 text-sm font-medium hover:bg-red-50 hover:shadow transition"
            >
              Reset
            </button>
          </div>

          {/*Listing of the Houses */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredListings.map((listing) => (
              <div key={listing.address} className="relative">
                <Link
                  href={`/browse/${encodeURIComponent(listing._id)}`}
                  className="block bg-white rounded-2xl shadow-md border hover:shadow-xl transition duration-300 overflow-hidden"
                >
                  <img
                    src={listing.images[0]}
                    alt={listing.address}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-6">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-2xl font-bold text-gray-900">
                        ${listing.rent}
                      </span>
                      {/* Empty space for heart positioning */}
                      <div className="w-6 h-6"></div>
                    </div>
                    <div className="flex space-x-4 text-gray-700 text-sm mb-2">
                      <span>{listing.bedrooms} Beds</span>
                      <span>{listing.bathrooms} Baths</span>
                      <span>{listing.area.toLocaleString()} Sq. Ft.</span>
                    </div>
                    <div className="text-gray-500 text-sm">
                      {listing.address}
                    </div>
                  </div>
                </Link>
                {/* Heart positioned absolutely outside the Link */}
                <div className="absolute top-4 right-4 z-10">
                  <div className="bg-white rounded-full p-2 shadow-lg hover:shadow-xl transition-shadow">
                    <HeartIcon listingId={listing._id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      </div>
    </>
  );
}
