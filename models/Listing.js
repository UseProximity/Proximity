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
  amenities: [{ type: String }],
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
