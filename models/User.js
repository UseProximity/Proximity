import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, index: true }, // consider: unique: true
    image: { type: String },
    role: { type: String, default: "student" },
    gender: { type: String, default: "unspecified" },
    age: { type: Number, default: 18 },
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "Listing" }],
    profileComplete: { type: Boolean, default: false },
  },
  { timestamps: true } // correct place for timestamps
);

export default mongoose.models.User || mongoose.model("User", UserSchema);
