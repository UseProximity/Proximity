/*
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

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Listing ||
  mongoose.model("Listing", listingSchema);
*/

import mongoose from "mongoose";

const unitTypeSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    rent: { type: Number, min: 0 },
    area: { type: Number, min: 0 },
    bedrooms: { type: Number, required: true, min: 0 },
    bathrooms: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const listingSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    trim: true,
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
    trim: true,
  },

  unitTypes: {
    type: [unitTypeSchema],
    required: true,
  },

  leaseStructure: {
    type: String,
    enum: ["individual", "joint"],
    required: true,
  },

  leaseAvailability: {
    type: String,
    enum: ["10_month", "12_month", "semester"],
  },

  moveInDate: {
    type: Date,
  },

  homeType: {
    type: String,
    enum: ["apartment", "house", "studio", "townhouse", "single_room", "condo"],
  },

  amenities: [
    {
      type: String,
      enum: [
        "dishwasher",
        "in_unit_laundry",
        "ac_heating",
        "mailroom",
        "pets_allowed",
        "extra_storage",
        "fireplace",
        "private_parking",
        "pool",
        "study_room",
      ],
    },
  ],

  furnished: {
    type: String,
    enum: ["furnished", "unfurnished"],
  },

  utilitiesIncluded: {
    type: Boolean,
    default: false,
  },

  subleaseFriendly: {
    type: Boolean,
    default: false,
  },

  walkingDistanceToCampus: {
    type: Number,
    min: 0,
  },

  walkingDistanceToShuttle: {
    type: Number,
    min: 0,
  },

  minRent: {
    type: Number,
    min: 0,
  },

  maxRent: {
    type: Number,
    min: 0,
  },

  minBathrooms: {
    type: Number,
    min: 0,
  },

  maxBathrooms: {
    type: Number,
    min: 0,
  },

  minBedrooms: {
    type: Number,
    min: 0,
  },

  maxBedrooms: {
    type: Number,
    min: 0,
  },

  minArea: {
    type: Number,
    min: 0,
  },

  maxArea: {
    type: Number,
    min: 0,
  },

  images: [{ type: String }],

  numReviews: {
    type: Number,
    default: 0,
    min: 0,
  },

  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },

  reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: "Review" }],

  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Listing ||
  mongoose.model("Listing", listingSchema);
