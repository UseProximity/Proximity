import mongoose from "mongoose";
import User from "@/models/User";

const connectMongo = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
  } catch (e) {
    console.error("Mongoose Error: " + e.message);
  }
};

export default connectMongo;
