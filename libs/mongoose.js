import mongoose from "mongoose";
import User from "@/models/User";
import Listing from "@/models/Listing";
import Review from "@/models/Review";

const connectMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (e) {
    console.error("Mongoose Error: " + e.message);
  }
};

export default connectMongo;
