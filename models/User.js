import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    birthday: { type: Date, default: null },
    description: { type: String, default: "" },
    email: { type: String, index: true }, // consider: unique: true
    contacted: [{ type: mongoose.Schema.Types.ObjectId, ref: "Listing" }],
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Listing" }],
    gender: { type: String, default: "unspecified" },
    image: { type: String },
    listings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Listing" }],
    name: { type: String },
    numReviews: { type: Number, default: 0 },
    phone: { type: String, default: "N/A" },
    profileComplete: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: "Review" }],
    referralSource: { type: String, default: "" },
    role: { type: String, default: "student" },
  },
  { timestamps: true }
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
