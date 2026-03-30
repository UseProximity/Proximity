import mongoose from "mongoose";

const unitTypeSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: false },
    rent: { type: Number, required: false },
    area: { type: Number, required: false },
    bedrooms: { type: Number, required: true },
    bathrooms: { type: Number, required: true },
  },
  { _id: false }
);

const listingSchema = new mongoose.Schema({
  title: {
    type: String,
    default: null,
  },
  address: {
    type: String,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  latitude: {
    type: Number,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  unitTypes: { type: [unitTypeSchema], required: true },
  leaseType: {
    type: String,
    required: true,
  },
  images: [
    {
      type: String,
    },
  ],
  numReviews: {
    type: Number,
    default: 0,
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: "Review" }],

  // Map of place name → walking minutes, e.g. { "Olin Library": 8, ... }
  placeWalkMinutes: {
    type: Map,
    of: Number,
    default: {},
  },

  // Minimum walking time (minutes) to any WashU shuttle stop
  shuttleWalkMinutes: {
    type: Number,
    default: null,
  },

  // Direct contact info — used for listings without a platform owner account
  contactEmail: { type: String, default: null },
  contactPhone: { type: String, default: null },
  contactName: { type: String, default: null },

  // Lease & unit metadata
  leaseAvailability: { type: String, default: null }, // "semester" | "10-month" | "12-month"
  leaseStructure: { type: String, default: null }, // "individual" | "joint"
  homeType: { type: String, default: "apartment" }, // "house" | "apartment" | "condo" | "townhouse"
  furnished: { type: Boolean, default: false },
  moveInDate: { type: String, default: null },
  utilitiesIncluded: {
    type: [{ type: String, enum: ["water", "sewer", "trash", "internet", "electric", "gas", "hotWater", "yardCare"] }],
    default: [],
  },
  subleaseFriendly: { type: Boolean, default: false },
  unavailable: { type: Boolean, default: false },

  // Computed aggregates from unitTypes
  minRent: { type: Number, default: null },
  maxRent: { type: Number, default: null },
  minBedrooms: { type: Number, default: null },
  maxBedrooms: { type: Number, default: null },
  minBathrooms: { type: Number, default: null },
  maxBathrooms: { type: Number, default: null },
  minArea: { type: Number, default: null },
  maxArea: { type: Number, default: null },

  amenities: [{ type: String }],

  numClicks: { type: Number, default: 0, min: 0 },
  numSaves: { type: Number, default: 0, min: 0 },

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  landlord: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
    validate: {
      validator: async function (userId) {
        if (userId == null) return true;
        const User = mongoose.model("User");
        const user = await User.findById(userId).select("role").lean();
        return user && (user.role === "landlord" || user.role === "super");
      },
      message: "Landlord must be a user with role 'landlord' or 'super'.",
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const collection = process.env.LISTINGS_COLLECTION || "listings";

export default mongoose.models.Listing ||
  mongoose.model("Listing", listingSchema, collection);
