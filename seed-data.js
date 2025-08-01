// Sample seed data for testing
// Run this in your MongoDB database or create an API endpoint

const sampleListings = [
  {
    address: "123 Main St, St. Louis, MO 63130",
    longitude: -90.3161,
    latitude: 38.627,
    description:
      "Beautiful 2-bedroom apartment near WashU campus with modern amenities and great views.",
    rent: 1200,
    area: 850,
    bedrooms: 2,
    bathrooms: 1,
    leaseType: "nine",
    images: ["/images/beaumont.jpg"],
    numReviews: 5,
    rating: 4,
    owner: "ObjectId('609bda5e1b85a5001f123456')", // You'll need a valid user ID
  },
  {
    address: "456 Forest Park Ave, St. Louis, MO 63108",
    longitude: -90.2934,
    latitude: 38.6362,
    description:
      "Spacious 3-bedroom house perfect for students. Walking distance to campus.",
    rent: 1800,
    area: 1200,
    bedrooms: 3,
    bathrooms: 2,
    leaseType: "twelve",
    images: ["/images/danforth.jpg"],
    numReviews: 8,
    rating: 5,
    owner: "ObjectId('609bda5e1b85a5001f123456')",
  },
];

// Instructions:
// 1. Connect to your MongoDB database
// 2. Insert these documents into your 'listings' collection
// 3. Make sure to replace the owner ObjectId with a valid user ID from your database
