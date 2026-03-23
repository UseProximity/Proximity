"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import AvailableListings from "@/components/show-listings/AvailableListings";
import TopFilterBar from "@/components/show-listings/TopFilterBar";
import { distance } from "framer-motion";

const WASHU_COORDS = { lat: 38.6496, lng: -90.3035 };

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Approximate WashU shuttle stop locations for proximity filtering
const SHUTTLE_STOPS = [
  { lat: 38.6495, lng: -90.3145 }, // Skinker & Lindell
  { lat: 38.6526, lng: -90.3067 }, // Delmar Loop
  { lat: 38.648, lng: -90.3035 }, // South campus
];

const DEFAULT_FILTERS = {
  minRent: "",
  maxRent: "",
  bedrooms: "", // min bedrooms
  maxBedrooms: "", // max bedrooms
  bathrooms: "", // min bathrooms
  maxBathrooms: "", // max bathrooms
  leaseType: "", // top-bar quick filter (home type string)
  distance: "", // walking time to campus (minutes)
  distanceToShuttle: "", // walking time to shuttle stop (minutes)
  moveInDate: "",
  homeType: [], // ['house','apartment','condo','townhouse','singleBedroom']
  leaseAvailability: [], // ['semester','10-month','12-month']
  amenities: [], // ['pool','studyRooms','inUnitLaundry','freeParking','petsAllowed']
  furnished: "", // '' | 'furnished' | 'unfurnished'
  utilitiesIncluded: false,
  subleaseFriendly: false,
  leaseStructure: "", // '' | 'individual' | 'joint'
  savedOnly: false,
};

export default function BrowseContent({ session }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get("search");

  const [search, setSearch] = useState(searchQuery || "");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        const response = await fetch("/api/listings");
        const data = await response.json();
        setListings(data);
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
    document.body.style.height = "100dvh";

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.height = originalHeight;
    };
  }, []);

  const handleClearSearch = () => {
    const url = new URL(window.location);
    url.searchParams.delete("search");
    window.history.replaceState({}, "", url);
  };

  const handleReset = () => {
    setSearch("");
    setFilters(DEFAULT_FILTERS);
    handleClearSearch();
  };

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      const lt = listing?.homeType?.toLowerCase() || "";
      const desc = listing?.description?.toLowerCase() || "";
      const amenitiesText = (listing?.amenities || []).join(" ").toLowerCase();
      const combined = desc + " " + amenitiesText;

      // Search
      const matchSearch = listing?.address
        .toLowerCase()
        .includes(search.toLowerCase());

      // Price
      const matchMinRent =
        !filters.minRent || listing?.maxRent >= Number(filters.minRent);
      const matchMaxRent =
        !filters.maxRent || listing?.minRent <= Number(filters.maxRent);

      // Beds / baths (range)
      const matchBeds =
        (!filters.bedrooms ||
          listing?.maxBedrooms >= Number(filters.bedrooms)) &&
        (!filters.maxBedrooms ||
          listing?.minBedrooms <= Number(filters.maxBedrooms));
      const matchBaths =
        (!filters.bathrooms ||
          listing?.maxBathrooms >= Number(filters.bathrooms)) &&
        (!filters.maxBathrooms ||
          listing?.minBathrooms <= Number(filters.maxBathrooms));

      // Top-bar Lease Type pill (home-type string match)
      const matchLeaseType =
        !filters.leaseType || lt.includes(filters.leaseType.toLowerCase());

      // Walking time to campus (3 mph → 1 mile = 20 min)
      let matchDistance = true;
      if (filters.distance && listing?.walkingDistanceToCampus) {
        matchDistance = filters.distance >= listing?.walkingDistanceToCampus;
      }
      /*
      if (filters.distance && listing.latitude && listing.longitude) {
        const maxMiles = parseFloat(filters.distance) / 20;
        const d = calculateDistance(
          listing.latitude,
          listing.longitude,
          WASHU_COORDS.lat,
          WASHU_COORDS.lng
        );
        matchDistance = d <= maxMiles;
      }
        */
      // Walking time to nearest shuttle stop
      let matchShuttle = true;
      if (filters.distanceToShuttle && listing?.walkingDistanceToShuttle) {
        matchShuttle =
          filters.distanceToShuttle >= listing?.walkingDistanceToShuttle;
      }
      /*
      if (filters.distanceToShuttle && listing.latitude && listing.longitude) {
        const maxMiles = parseFloat(filters.distanceToShuttle) / 20;
        matchShuttle = SHUTTLE_STOPS.some((stop) => {
          const d = calculateDistance(
            listing.latitude,
            listing.longitude,
            stop.lat,
            stop.lng
          );
          return d <= maxMiles;
        });
      }
        */

      // Home type
      let matchHomeType = true;
      if (filters.homeType && filters.homeType.length > 0) {
        matchHomeType = filters.homeType.some((type) => {
          switch (type) {
            case "house":
              return lt.includes("house");
            case "apartment":
              return lt.includes("apartment");
            case "condo":
              return lt.includes("condo");
            case "townhouse":
              return lt.includes("townhouse");
            case "singleBedroom":
              return listing?.minBedrooms === 1;
            default:
              return true;
          }
        });
      }

      // Lease availability (semester / 10-month / 12-month)
      let matchLeaseAvail = true;
      if (filters.leaseAvailability && filters.leaseAvailability.length > 0) {
        matchLeaseAvail = filters.leaseAvailability.some((avail) => {
          switch (avail) {
            case "semester":
              return (
                lt.includes("semester") ||
                desc.includes("semester") ||
                listing?.leaseAvailability === "semester"
              );
            case "10-month":
              return (
                lt.includes("10") ||
                desc.includes("10 month") ||
                desc.includes("10-month") ||
                listing?.leaseAvailability === "10_month"
              );
            case "12-month":
              return (
                lt.includes("12") ||
                lt.includes("year") ||
                desc.includes("12 month") ||
                desc.includes("12-month") ||
                listing?.leaseAvailability === "12_month"
              );
            default:
              return true;
          }
        });
      }

      // Amenities (all selected must match)
      let matchAmenities = true;
      if (filters.amenities && filters.amenities.length > 0) {
        matchAmenities = filters.amenities.every((amenity) => {
          switch (amenity) {
            case "gym":
              return combined.includes("gym") || combined.includes("fitness");
            case "studyRooms":
              return (
                combined.includes("study room") ||
                combined.includes("study lounge") ||
                combined.includes("study_room")
              );
            case "inUnitLaundry":
              return (
                combined.includes("in-unit laundry") ||
                combined.includes("in unit laundry") ||
                combined.includes("washer") ||
                combined.includes("dryer") ||
                combined.includes("in_unit_laundry")
              );
            case "freeParking":
              return (
                combined.includes("free parking") ||
                combined.includes("parking included") ||
                combined.includes("parking") ||
                combined.includes("private_parking")
              );
            case "petsAllowed":
              return (
                combined.includes("pet") || combined.includes("pets_allowed")
              );
            case "dishwasher":
              return combined.includes("dishwasher");
            case "extraStorage":
              return (
                combined.includes("storage") ||
                combined.includes("extra storage") ||
                combined.includes("extra_storage")
              );
            case "fireplace":
              return combined.includes("fireplace");
            case "mailroom":
              return combined.includes("mailroom");
            case "pool":
              return combined.includes("pool");
            default:
              return true;
          }
        });
      }

      // Furnished
      let matchFurnished = true;
      if (filters.furnished === "furnished") {
        matchFurnished =
          (combined.includes("furnished") &&
            !combined.includes("unfurnished")) ||
          listing?.furnished === "furnished";
      } else if (filters.furnished === "unfurnished") {
        matchFurnished =
          combined.includes("unfurnished") ||
          !combined.includes("furnished") ||
          listing?.furnished === "unfurnished";
      }

      // Utilities included
      let matchUtilities = true;
      if (filters.utilitiesIncluded) {
        matchUtilities =
          combined.includes("utilities included") ||
          combined.includes("utilities are included") ||
          combined.includes("all utilities") ||
          listing?.utilitiesIncluded === true;
      }

      // Sublease friendly
      let matchSublease = true;
      if (filters.subleaseFriendly) {
        matchSublease =
          lt.includes("subleas") ||
          desc.includes("subleas") ||
          desc.includes("subletting allowed") ||
          listing?.subleaseFriendly === true;
      }

      // Lease structure
      let matchLeaseStructure = true;
      if (filters.leaseStructure === "individual") {
        matchLeaseStructure =
          lt.includes("individual") ||
          desc.includes("individual lease") ||
          desc.includes("by the room") ||
          listing?.leaseStructure === "individual";
      } else if (filters.leaseStructure === "joint") {
        matchLeaseStructure =
          lt.includes("joint") ||
          desc.includes("joint lease") ||
          desc.includes("whole unit") ||
          listing?.leaseStructure === "joint";
      }

      const userFavorites =
        session?.user?.favorites || session?.user?.favoritesIds || [];
      const matchSaved =
        !filters.savedOnly ||
        userFavorites.some(
          (f) => String((f && f._id) || f) === String(listing._id)
        );

      return (
        matchSearch &&
        matchMinRent &&
        matchMaxRent &&
        matchBeds &&
        matchBaths &&
        matchLeaseType &&
        matchDistance &&
        matchShuttle &&
        matchHomeType &&
        matchLeaseAvail &&
        matchAmenities &&
        matchFurnished &&
        matchUtilities &&
        matchSublease &&
        matchLeaseStructure &&
        matchSaved
      );
    });
  }, [listings, search, filters]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading listings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 flex flex-col h-[calc(100dvh-83px)] md:h-[calc(100dvh-104px)]">
      <div className="hidden md:block">
        <TopFilterBar
          search={search}
          setSearch={setSearch}
          filters={filters}
          setFilters={setFilters}
          onReset={handleReset}
        />
      </div>
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        <AvailableListings
          session={session}
          listings={filteredListings}
          filters={filters}
          setFilters={setFilters}
          handleReset={handleReset}
          onClearSearch={handleClearSearch}
          search={search}
          setSearch={setSearch}
        />
      </div>
    </div>
  );
}
