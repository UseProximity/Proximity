import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    age: { type: Number, default: 18 },
    description: { type: String, default: "" },
    email: { type: String, index: true }, // consider: unique: true
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Listing" }],
    gender: { type: String, default: "unspecified" },
    image: { type: String },
    name: { type: String },
    numReviews: { type: Number, default: 0 },
    phone: { type: String, default: "N/A" },
    profileComplete: { type: Boolean, default: false },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    role: { type: String, default: "student" },
  },
  { timestamps: true } // correct place for timestamps
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
