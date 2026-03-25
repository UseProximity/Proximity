import mongoose from "mongoose";

const testimonialSchema = new mongoose.Schema(
  {
    text:   { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
  },
  { timestamps: true }
);

export default mongoose.models.Testimonial ||
  mongoose.model("Testimonial", testimonialSchema);
