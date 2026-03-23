import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongoose from "mongoose";
import Listing from "../models/Listing.js";

const SHUTTLE_STOPS = [
  { lat: 38.6495, lng: -90.3145 }, // Skinker & Lindell
  { lat: 38.6526, lng: -90.3067 }, // Delmar Loop
  { lat: 38.648, lng: -90.3035 }, // South campus
];

const WASHU_COORDS = { lat: 38.6496, lng: -90.3035 };

// Haversine distance in miles
function calculateDistanceMiles(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;

  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Approximate walking time in minutes
// Assumes ~3 mph walking speed => ~20 min per mile
function milesToWalkingMinutes(miles) {
  return Math.round(miles * 20);
}

async function migrateListings() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const listings = await Listing.find();

    for (const listing of listings) {
      let changed = false;

      // -----------------------------
      // Migrate old leaseType values
      // -----------------------------
      const oldLeaseType = listing.leaseType;

      if (!listing.leaseStructure) {
        if (oldLeaseType === "individual" || oldLeaseType === "joint") {
          listing.leaseStructure = oldLeaseType;
          changed = true;
        } else {
          listing.leaseStructure = "individual";
          changed = true;
        }
      }

      if (!listing.leaseAvailability) {
        if (oldLeaseType === "twelve") {
          listing.leaseAvailability = "12_month";
          changed = true;
        } else if (oldLeaseType === "academic") {
          listing.leaseAvailability = "semester";
          changed = true;
        } else if (oldLeaseType === "nine") {
          listing.leaseAvailability = "10_month";
          changed = true;
        }
      }

      if (oldLeaseType === "sublease" && listing.subleaseFriendly !== true) {
        listing.subleaseFriendly = true;
        changed = true;
      }

      // -----------------------------
      // Compute derived unit fields
      // -----------------------------
      const unitTypes = Array.isArray(listing.unitTypes)
        ? listing.unitTypes
        : [];

      const rents = unitTypes
        .map((u) => Number(u?.rent))
        .filter((value) => Number.isFinite(value));

      const bedrooms = unitTypes
        .map((u) => Number(u?.bedrooms))
        .filter((value) => Number.isFinite(value));

      const bathrooms = unitTypes
        .map((u) => Number(u?.bathrooms))
        .filter((value) => Number.isFinite(value));

      const areas = unitTypes
        .map((u) => Number(u?.area))
        .filter((value) => Number.isFinite(value));

      const nextMinRent = rents.length ? Math.min(...rents) : undefined;
      const nextMaxRent = rents.length ? Math.max(...rents) : undefined;
      const nextMinBedrooms = bedrooms.length
        ? Math.min(...bedrooms)
        : undefined;
      const nextMaxBedrooms = bedrooms.length
        ? Math.max(...bedrooms)
        : undefined;
      const nextMinBathrooms = bathrooms.length
        ? Math.min(...bathrooms)
        : undefined;
      const nextMaxBathrooms = bathrooms.length
        ? Math.max(...bathrooms)
        : undefined;
      const nextMinArea = areas.length ? Math.min(...areas) : undefined;
      const nextMaxArea = areas.length ? Math.max(...areas) : undefined;

      if (listing.minRent !== nextMinRent) {
        listing.minRent = nextMinRent;
        changed = true;
      }

      if (listing.maxRent !== nextMaxRent) {
        listing.maxRent = nextMaxRent;
        changed = true;
      }

      if (listing.minBedrooms !== nextMinBedrooms) {
        listing.minBedrooms = nextMinBedrooms;
        changed = true;
      }

      if (listing.maxBedrooms !== nextMaxBedrooms) {
        listing.maxBedrooms = nextMaxBedrooms;
        changed = true;
      }

      if (listing.minBathrooms !== nextMinBathrooms) {
        listing.minBathrooms = nextMinBathrooms;
        changed = true;
      }

      if (listing.maxBathrooms !== nextMaxBathrooms) {
        listing.maxBathrooms = nextMaxBathrooms;
        changed = true;
      }

      if (listing.minArea !== nextMinArea) {
        listing.minArea = nextMinArea;
        changed = true;
      }

      if (listing.maxArea !== nextMaxArea) {
        listing.maxArea = nextMaxArea;
        changed = true;
      }

      // -----------------------------
      // Compute campus / shuttle walking times
      // -----------------------------
      const latitude = Number(listing.latitude);
      const longitude = Number(listing.longitude);

      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        const campusMiles = calculateDistanceMiles(
          latitude,
          longitude,
          WASHU_COORDS.lat,
          WASHU_COORDS.lng
        );

        const nearestShuttleMiles = Math.min(
          ...SHUTTLE_STOPS.map((stop) =>
            calculateDistanceMiles(latitude, longitude, stop.lat, stop.lng)
          )
        );

        const nextWalkingDistanceToCampus = milesToWalkingMinutes(campusMiles);
        const nextWalkingDistanceToShuttle =
          milesToWalkingMinutes(nearestShuttleMiles);

        if (listing.walkingDistanceToCampus !== nextWalkingDistanceToCampus) {
          listing.walkingDistanceToCampus = nextWalkingDistanceToCampus;
          changed = true;
        }

        if (listing.walkingDistanceToShuttle !== nextWalkingDistanceToShuttle) {
          listing.walkingDistanceToShuttle = nextWalkingDistanceToShuttle;
          changed = true;
        }
      }

      if (changed) {
        await listing.save();
        console.log(`Updated listing ${listing._id}`);
      }
    }

    console.log("Migration complete");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrateListings();
