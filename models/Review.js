import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    // Who is writing the review
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // If the review is for a user
    reviewedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    // If the review is for a listing
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
      required: false,
    },

    rating: {
      type: Number,
      required: true,
      min: 0,
      max: 5,
    },

    // Written comment
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    // To mark if the review is verified or not by the corresponding landlord
    legitimacy: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.Review || mongoose.model("Review", reviewSchema);
