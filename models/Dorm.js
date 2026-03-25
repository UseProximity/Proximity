import mongoose from "mongoose";

const dormSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    roomTypes:   [{ type: String }],
    description: { type: String, default: "" },
    tags:        [{ type: String }],
    image:       { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.Dorm || mongoose.model("Dorm", dormSchema);
