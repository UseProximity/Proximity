"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import AvailableListings from "@/components/AvailableListings";
import { Suspense } from "react";

export default function Browse() {
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
        // For now, use mock data if API fails
        const mockListings = [
          {
            _id: "1",
            title: "Modern 3BR Near The Loop",
            address: "6659 Washington Ave, University City, MO 63130",
            longitude: -90.3161,
            latitude: 38.6575,
            rent: 3500,
            bedrooms: 3,
            bathrooms: 3,
            area: 2610,
            description: "Beautiful house with parking, gym nearby",
            amenities: ["parking", "gym", "laundry"],
            petFriendly: true,
            owner: "landlord1",
            images: ["/images/beaumont.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "2",
            title: "Cozy 4BR Apartment",
            address: "333 Sherman Ave, Clayton, MO 63105",
            longitude: -90.2934,
            latitude: 38.6362,
            rent: 2000,
            bedrooms: 4,
            bathrooms: 2.5,
            area: 2610,
            description: "Spacious apartment with natural lighting",
            amenities: ["gym", "pool", "dishwasher"],
            petFriendly: false,
            owner: "landlord2",
            images: ["/images/danforth.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "3",
            title: "Student Townhouse",
            address: "789 Pine St, University City, MO 63130",
            longitude: -90.3089,
            latitude: 38.6489,
            rent: 950,
            bedrooms: 3,
            bathrooms: 2.5,
            area: 1800,
            description: "Spacious townhouse with garage parking and laundry",
            amenities: ["parking", "laundry", "dishwasher"],
            petFriendly: true,
            owner: "landlord3",
            images: ["/images/eliot-a.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "4",
            title: "Luxury 2BR Near Campus",
            address: "321 Elm St, Clayton, MO 63105",
            longitude: -90.2987,
            latitude: 38.6456,
            rent: 1800,
            bedrooms: 2,
            bathrooms: 2,
            area: 1200,
            description: "Modern apartment close to WashU with fitness center",
            amenities: ["gym", "pool", "ac"],
            petFriendly: false,
            owner: "landlord4",
            images: ["/images/eliot-b.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "5",
            title: "Affordable Loop House",
            address: "555 Delmar Blvd, University City, MO 63130",
            longitude: -90.3234,
            latitude: 38.6587,
            rent: 1200,
            bedrooms: 3,
            bathrooms: 1,
            area: 1000,
            description: "Affordable house in the heart of the Loop district",
            amenities: ["laundry"],
            petFriendly: true,
            owner: "landlord5",
            images: ["/images/greenway.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "6",
            title: "Upscale Studio",
            address: "123 Forest Park Pkwy, St. Louis, MO 63108",
            longitude: -90.2756,
            latitude: 38.6398,
            rent: 1500,
            bedrooms: 1,
            bathrooms: 1,
            area: 600,
            description: "Modern studio with great amenities",
            amenities: ["gym", "pool", "concierge"],
            petFriendly: false,
            owner: "landlord6",
            images: ["/images/mudd.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "7",
            title: "Family House in Clayton",
            address: "987 Big Bend Blvd, Clayton, MO 63105",
            longitude: -90.3145,
            latitude: 38.6234,
            rent: 2800,
            bedrooms: 4,
            bathrooms: 3,
            area: 2400,
            description: "Large family house with yard and garage",
            amenities: ["parking", "yard", "fireplace"],
            petFriendly: true,
            owner: "landlord7",
            images: ["/images/park.jpeg"],
            createdAt: new Date().toISOString(),
          },
          {
            _id: "8",
            title: "Close to Campus Duplex",
            address: "456 Skinker Blvd, St. Louis, MO 63130",
            longitude: -90.2998,
            latitude: 38.6512,
            rent: 1600,
            bedrooms: 2,
            bathrooms: 1.5,
            area: 900,
            description: "Duplex very close to WashU campus",
            amenities: ["parking", "laundry"],
            petFriendly: true,
            owner: "landlord8",
            images: ["/images/umrath.jpeg"],
            createdAt: new Date().toISOString(),
          },
        ];
        setListings(mockListings);
        setFilteredListings(mockListings);
      } finally {
        setLoading(false);
      }
    };

    fetchListings();
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
        <Header />
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
    <Suspense fallback={<div>Loading...</div>}>
      <>
        <Header />
        <div className="min-h-screen bg-gray-50">
          <div className="flex flex-col md:flex-row h-screen">
            <AvailableListings
              listings={filteredListings}
              onClearSearch={handleClearSearch}
            />
          </div>
        </div>
      </>
    </Suspense>
  );
}
