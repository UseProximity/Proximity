"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import AvailableListings from "@/components/show-listings/AvailableListings";

export default function BrowseContent({ session }) {
  const [listings, setListings] = useState([]);
  const [filteredListings, setFilteredListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search");

  useEffect(() => {
    const fetchListings = async () => {
      try {
        const response = await fetch("/api/listings");
        const data = await response.json();
        setListings(data);
        setFilteredListings(data);
      } catch (error) {
        console.error("Error fetching listings:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchListings();
  }, []);

  // Lock body scroll to prevent page dragging
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    const originalHeight = document.body.style.height;

    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.height = originalHeight;
    };
  }, []);

  useEffect(() => {
    if (searchQuery && listings.length > 0) {
      const filtered = listings.filter((listing) => {
        const searchLower = searchQuery.toLowerCase().trim();

        // Enhanced search parsing - break down the query into components
        const parseSearchQuery = (query) => {
          const criteria = {
            bedrooms: null,
            bathrooms: null,
            maxPrice: null,
            location: null,
            amenities: [],
            generalTerms: [],
          };

          // More flexible bedroom patterns
          const bedroomPatterns = [
            /(\d+)\s*(?:bed|bedroom|br|bdr)s?/gi,
            /(\d+)\s*b[^a]/gi, // catches "3b" but not "3bath"
            /(\d+)\s+bed/gi,
            /(\d+)[-\s]*bedroom/gi,
            /(\d+)[-\s]*bed/gi,
          ];

          for (const pattern of bedroomPatterns) {
            const match = query.match(pattern);
            if (match) {
              criteria.bedrooms = parseInt(match[0].match(/\d+/)[0]);
              break;
            }
          }

          // More flexible bathroom patterns
          const bathroomPatterns = [
            /(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba)s?/g,
            /(\d+(?:\.\d+)?)\s*ba[^c]/g, // catches "3ba" but not "back"
          ];

          for (const pattern of bathroomPatterns) {
            const match = query.match(pattern);
            if (match) {
              criteria.bathrooms = parseFloat(
                match[0].match(/\d+(?:\.\d+)?/)[0]
              );
              break;
            }
          }

          // Enhanced price patterns
          const pricePatterns = [
            /under\s*\$?(\d+)/g,
            /below\s*\$?(\d+)/g,
            /less\s+than\s*\$?(\d+)/g,
            /max\s*\$?(\d+)/g,
            /\$(\d+)\s*(?:or\s+)?(?:less|under|below|max)/g,
            /(\d+)\s*(?:dollar|bucks?)\s*(?:or\s+)?(?:less|under|below|max)/g,
          ];

          for (const pattern of pricePatterns) {
            const match = query.match(pattern);
            if (match) {
              const priceStr = match[0].match(/\d+/)[0];
              criteria.maxPrice = parseInt(priceStr);
              break;
            }
          }

          // Location patterns
          const locationPatterns = [
            /near\s+([^,]+?)(?:\s+(?:with|under|below|\d+)|$)/g,
            /in\s+([^,]+?)(?:\s+(?:with|under|below|\d+)|$)/g,
            /(?:close\s+to|by)\s+([^,]+?)(?:\s+(?:with|under|below|\d+)|$)/g,
          ];

          for (const pattern of locationPatterns) {
            const match = query.match(pattern);
            if (match) {
              criteria.location = match[0]
                .replace(/^(?:near|in|close\s+to|by)\s+/i, "")
                .trim();
              break;
            }
          }

          // Amenity patterns
          const amenityKeywords = [
            "parking",
            "garage",
            "gym",
            "fitness",
            "pool",
            "laundry",
            "washer",
            "dryer",
            "dishwasher",
            "ac",
            "air conditioning",
            "heating",
            "balcony",
            "patio",
            "pet friendly",
            "pets allowed",
            "dog",
            "cat",
            "furnished",
            "unfurnished",
          ];

          amenityKeywords.forEach((amenity) => {
            if (query.includes(amenity)) {
              criteria.amenities.push(amenity);
            }
          });

          // Extract general terms (words not caught by specific patterns)
          const words = query.split(/\s+/);
          const usedWords = new Set();

          // Mark words used in specific criteria
          if (criteria.bedrooms) {
            words.forEach((word, i) => {
              if (
                word.includes(criteria.bedrooms.toString()) ||
                /bed|bedroom|br|bdr/.test(word)
              ) {
                usedWords.add(i);
                if (i > 0) usedWords.add(i - 1); // number before
                if (i < words.length - 1) usedWords.add(i + 1); // word after
              }
            });
          }

          if (criteria.bathrooms) {
            words.forEach((word, i) => {
              if (
                word.includes(criteria.bathrooms.toString()) ||
                /bath|bathroom|ba/.test(word)
              ) {
                usedWords.add(i);
                if (i > 0) usedWords.add(i - 1);
                if (i < words.length - 1) usedWords.add(i + 1);
              }
            });
          }

          if (criteria.maxPrice) {
            words.forEach((word, i) => {
              if (
                word.includes(criteria.maxPrice.toString()) ||
                /under|below|less|max|\$|dollar|buck/.test(word)
              ) {
                usedWords.add(i);
                if (i > 0) usedWords.add(i - 1);
                if (i < words.length - 1) usedWords.add(i + 1);
              }
            });
          }

          // Remaining words are general terms
          words.forEach((word, i) => {
            if (!usedWords.has(i) && word.length > 2) {
              criteria.generalTerms.push(word);
            }
          });

          return criteria;
        };

        const criteria = parseSearchQuery(searchLower);
        let matches = true;

        // Check bedrooms (exact match for better accuracy)
        if (criteria.bedrooms !== null) {
          matches = matches && listing.bedrooms === criteria.bedrooms;
        }

        // Check bathrooms (allow equal or greater)
        if (criteria.bathrooms !== null) {
          matches = matches && listing.bathrooms >= criteria.bathrooms;
        }

        // Check price
        if (criteria.maxPrice !== null) {
          matches = matches && listing.rent <= criteria.maxPrice;
        }

        // Check location
        if (criteria.location) {
          const location = criteria.location.toLowerCase();
          matches =
            matches &&
            (listing.address.toLowerCase().includes(location) ||
              listing.title.toLowerCase().includes(location) ||
              listing.description.toLowerCase().includes(location));
        }

        // Check amenities
        if (criteria.amenities.length > 0) {
          const hasAmenities = criteria.amenities.every((amenity) => {
            return (
              listing.amenities?.some((a) =>
                a.toLowerCase().includes(amenity)
              ) ||
              listing.description.toLowerCase().includes(amenity) ||
              (amenity.includes("pet") && listing.petFriendly) ||
              listing.title.toLowerCase().includes(amenity)
            );
          });
          matches = matches && hasAmenities;
        }

        // Check general terms (fallback for unstructured search)
        if (
          criteria.generalTerms.length > 0 &&
          !criteria.bedrooms &&
          !criteria.bathrooms &&
          !criteria.maxPrice &&
          !criteria.location &&
          criteria.amenities.length === 0
        ) {
          const hasGeneralTerms = criteria.generalTerms.some(
            (term) =>
              listing.title.toLowerCase().includes(term) ||
              listing.address.toLowerCase().includes(term) ||
              listing.description.toLowerCase().includes(term)
          );
          matches = matches && hasGeneralTerms;
        }

        return matches;
      });

      setFilteredListings(filtered);
    } else {
      setFilteredListings(listings);
    }
  }, [searchQuery, listings]);

  const handleClearSearch = () => {
    // Clear the URL search params
    const url = new URL(window.location);
    url.searchParams.delete("search");
    window.history.replaceState({}, "", url);

    // Reset filtered listings to show all listings
    setFilteredListings(listings);
  };

  if (loading) {
    return (
      <>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading listings...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="bg-gray-50">
        <div
          className="flex flex-col md:flex-row overflow-hidden"
          style={{ height: "calc(100vh - 64px)" }}
        >
          <AvailableListings
            session={session}
            listings={filteredListings}
            onClearSearch={handleClearSearch}
          />
        </div>
      </div>
    </>
  );
}
