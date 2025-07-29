"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useFavorites } from "@/context/FavoritesContext";
import HeartIcon from "./HeartIcon";

export default function SavedListingsSection() {
  const { favorites } = useFavorites();
  const [savedListings, setSavedListings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (favorites.size > 0) {
      fetchSavedListings();
    } else {
      setSavedListings([]);
    }
  }, [favorites]);

  const fetchSavedListings = async () => {
    setIsLoading(true);
    try {
      const favoriteIds = Array.from(favorites);
      const promises = favoriteIds.map(async (id) => {
        const response = await fetch(`/api/listing/${id}`);
        if (response.ok) {
          return await response.json();
        }
        return null;
      });

      const results = await Promise.all(promises);
      const validListings = results.filter((listing) => listing !== null);
      setSavedListings(validListings);
    } catch (error) {
      console.error("Error fetching saved listings:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-white border rounded-lg shadow-sm">
        <h2 className="text-lg font-semibold text-red-500 mb-4">
          Saved Listings
        </h2>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white border rounded-lg shadow-sm">
      <h2 className="text-lg font-semibold text-red-500 mb-4">
        Saved Listings ({favorites.size})
      </h2>

      {savedListings.length === 0 ? (
        <p className="text-gray-500">
          No saved listings yet. Click the heart icon on listings to save them
          here.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {savedListings.map((listing) => (
            <Link
              key={listing._id}
              href={`/browse/${encodeURIComponent(listing._id)}`}
              className="block bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-lg">${listing.rent}</h3>
                  <p className="text-gray-600 text-sm">{listing.address}</p>
                </div>
                <HeartIcon listingId={listing._id} className="h-5 w-5" />
              </div>

              <div className="flex space-x-4 text-sm text-gray-500 mb-2">
                <span>{listing.bedrooms} beds</span>
                <span>{listing.bathrooms} baths</span>
                <span>{listing.area?.toLocaleString()} sq ft</span>
              </div>

              {listing.images && listing.images[0] && (
                <img
                  src={listing.images[0]}
                  alt={listing.address}
                  className="w-full h-32 object-cover rounded mt-2"
                />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
