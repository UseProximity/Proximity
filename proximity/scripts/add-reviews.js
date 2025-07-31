// Script to add reviews to all listings
const mongoose = require("mongoose");

// Connect to MongoDB
const connectMongo = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/housing-app"
    );
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

// Listing Schema
const listingSchema = new mongoose.Schema({
  address: String,
  longitude: Number,
  latitude: Number,
  description: String,
  rent: Number,
  area: Number,
  bedrooms: Number,
  bathrooms: Number,
  leaseType: String,
  images: [String],
  numReviews: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
  reviews: [
    {
      name: String,
      rating: Number,
      comment: String,
      createdAt: { type: Date, default: Date.now },
    },
  ],
});

const Listing =
  mongoose.models.Listing || mongoose.model("Listing", listingSchema);

// Sample reviews for variety
const reviewTemplates = [
  {
    names: ["Emily R.", "Sarah M.", "Jessica L.", "Amanda K.", "Rachel P."],
    comments: [
      "Loved living here! The landlord was very responsive and the neighborhood felt safe and quiet. Highly recommend.",
      "Great location close to campus. The apartment was clean and well-maintained throughout my lease.",
      "Really enjoyed my time here. Good value for the money and great neighbors.",
      "Perfect for students! Close to everything and the landlord is super helpful.",
      "Beautiful place with lots of natural light. Would definitely live here again.",
    ],
  },
  {
    names: ["Jake T.", "Mike D.", "Alex C.", "Ryan B.", "Chris W."],
    comments: [
      "Solid place to live. Good amenities and reasonable rent for the area.",
      "Great apartment with modern appliances. The location is perfect for getting to class.",
      "Really happy with this place. Clean, safe, and the landlord responds quickly to any issues.",
      "Excellent value and great for students. Would recommend to friends.",
      "Nice quiet neighborhood but still close to campus activities.",
    ],
  },
  {
    names: ["Sophia L.", "Maya N.", "Grace H.", "Olivia S.", "Zoe F."],
    comments: [
      "Great place for students, close to everything. A few minor repairs needed during my stay, but they were fixed quickly.",
      "Love the spacious rooms and the natural light. Perfect for studying and relaxing.",
      "Fantastic location and the apartment exceeded my expectations. Highly recommended!",
      "Clean, affordable, and in a great neighborhood. Perfect for my junior year.",
      "The perfect balance of being close to campus but in a quiet residential area.",
    ],
  },
];

// Function to get random review
const getRandomReview = () => {
  const template =
    reviewTemplates[Math.floor(Math.random() * reviewTemplates.length)];
  const name =
    template.names[Math.floor(Math.random() * template.names.length)];
  const comment =
    template.comments[Math.floor(Math.random() * template.comments.length)];
  const rating = Math.random() < 0.7 ? 5 : 4; // 70% chance of 5 stars, 30% chance of 4 stars

  return { name, rating, comment };
};

// Function to calculate average rating
const calculateAverageRating = (reviews) => {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10; // Round to 1 decimal place
};

// Main function to add reviews to all listings
const addReviewsToAllListings = async () => {
  try {
    await connectMongo();

    // Get all listings
    const listings = await Listing.find({});
    console.log(`Found ${listings.length} listings`);

    for (const listing of listings) {
      // Generate 2-3 reviews for each listing
      const numReviews = Math.random() < 0.5 ? 2 : 3;
      const reviews = [];

      for (let i = 0; i < numReviews; i++) {
        reviews.push(getRandomReview());
      }

      // Calculate average rating
      const averageRating = calculateAverageRating(reviews);

      // Update the listing
      await Listing.findByIdAndUpdate(listing._id, {
        reviews: reviews,
        numReviews: reviews.length,
        rating: averageRating,
      });

      console.log(
        `Updated listing at ${listing.address} with ${reviews.length} reviews (avg rating: ${averageRating})`
      );
    }

    console.log("Successfully added reviews to all listings!");
    process.exit(0);
  } catch (error) {
    console.error("Error adding reviews:", error);
    process.exit(1);
  }
};

// Run the script
addReviewsToAllListings();
