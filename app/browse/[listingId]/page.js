"use client";
import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { notFound } from "next/navigation";
import Link from "next/link";
import ConditionalButtons from "@/components/ConditionalButtons";

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

function HeartIcon() {
  const [isFavorite, setIsFavorite] = useState(false);

  const handleClick = () => {
    setIsFavorite(!isFavorite);
  };

  return (
    <button
      onClick={handleClick}
      className="focus:outline-none rounded-full bg-white p-2 shadow-md border border-gray-300 hover:bg-gray-100 transition-all"
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
    >
      {isFavorite ? (
        // Filled Heart Icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="red"
          viewBox="0 0 24 24"
          className="h-6 w-6"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      ) : (
        // Unfilled Heart Icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          className="h-6 w-6"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      )}
    </button>
  );
}

export default function ListingDetails({ params }) {
  const [listing, setListing] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const { listingId } = params;

  useEffect(() => {
    fetchListing();
  }, [listingId]);

  const fetchListing = async () => {
    try {
      const response = await fetch(
        `/api/listing/${encodeURIComponent(listingId)}`
      );
      if (response.ok) {
        const data = await response.json();
        setListing(data);
      } else {
        setListing(null);
      }
    } catch (error) {
      console.error("Error fetching listing:", error);
      setListing(null);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <Header />
        <div className="bg-gray-100 min-h-screen">
          <div className="max-w-7xl mx-auto px-4 py-8">
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!listing) {
    notFound();
  }

  const safeListing = listing;

  const leaseTypeMap = {
    sublease: "Sub-Lease",
    nine: "9 Month Lease",
    twelve: "12 Month Lease",
    academic: "Academic Year",
  };

  return (
    <>
      <Header />
      <div className="bg-gray-100 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Image + Gallery */}
          {/* Back Button */}
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => window.history.back()}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg shadow-md transition-all"
            >
              ← Go Back
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="relative md:col-span-2">
              <img
                src={safeListing.images[0]}
                alt={safeListing.address}
                className="rounded-xl w-full h-[400px] object-cover shadow"
              />
              <div className="absolute top-3 right-3">
                <HeartIcon />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-3 bg-white p-6 rounded-xl shadow-md">
              <div className="flex justify-between items-center">
                <div className="text-3xl font-bold text-gray-900">
                  ${safeListing.rent}
                </div>
              </div>
              <div className="text-gray-700">{safeListing.address}</div>
              <div className="text-sm text-gray-500">
                Listed by <strong>{safeListing.owner.name}</strong>
              </div>

              {/*Landlord profile and Rating Thing */}
              <Link
                href={`/landlord/${encodeURIComponent(safeListing.owner._id)}`}
              >
                {/**FIX-ME make the url unique for each landlord (not using the name) */}
                <div className="flex items-center gap-2 mt-1">
                  <img
                    src={safeListing.owner.image}
                    alt={safeListing.owner.name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div>
                    <div className="text-yellow-500 text-sm leading-tight">
                      {"★".repeat(safeListing.owner.rating)}
                      <span className="text-gray-300">
                        {"★".repeat(5 - safeListing.owner.rating)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">Landlord Rating</p>
                  </div>
                </div>
              </Link>

              <ConditionalButtons listing={safeListing} />
            </div>
          </div>

          {/* Specs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {safeListing.bedrooms}
              </div>
              <div className="text-sm text-gray-500">Beds</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {safeListing.bathrooms}
              </div>
              <div className="text-sm text-gray-500">Baths</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {safeListing.area.toLocaleString()}
              </div>
              <div className="text-sm text-gray-500">Sq Ft</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-lg font-semibold">
                {leaseTypeMap[safeListing.leaseType] || safeListing.leaseType}
              </div>
              <div className="text-sm text-gray-500">Lease Type</div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <h2 className="text-xl font-semibold mb-4">Property Overview</h2>
            <p className="text-gray-700 leading-relaxed">
              Welcome to this charming listing located at{" "}
              <strong>{safeListing.address}</strong>! This beautiful home
              features {safeListing.bedrooms} spacious bedrooms and{" "}
              {safeListing.bathrooms} elegant bathrooms, boasting a total of{" "}
              {safeListing.area.toLocaleString()} square feet. Perfect for
              families, professionals, or students looking for a spacious and
              modern place to live near campus or the city center.
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
              {/* 
              {safeListing.reviews && safeListing.reviews.length > 0 ? (
                safeListing.reviews.map((review, index) => (
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
                ))
              ) : (
                <p className="text-gray-500">No reviews yet</p>
              )}
                          */}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
