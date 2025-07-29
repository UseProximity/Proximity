import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  gender: {
    type: String,
    required: true,
  },
  age: {
    type: Number,
    required: true,
  },
  numReviews: {
    type: Number,
    default: 0,
  },
  rating: {
    type: Number,
    default: 0,
  },
  image: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  role: {
    type: String,
    enum: ["student", "landlord"],
    default: "student",
    required: true,
  },
  favorites: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Listing",
    },
  ],
  email: {
    type: String,
  },
  phone: {
    type: String,
  },
});

export default mongoose.models.User || mongoose.model("User", userSchema);
