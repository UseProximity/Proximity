import mongoose from "mongoose";

const dormReviewSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    classYear: { type: Number, required: true },
    rating:    { type: Number, required: true, min: 1, max: 5 },
    dorm:      { type: String, required: true, trim: true },
    dormType:  { type: String, required: false, trim: true, default: "" },
    tags:      [{ type: String }],
    content:   { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

export default mongoose.models.DormReview ||
  mongoose.model("DormReview", dormReviewSchema);
