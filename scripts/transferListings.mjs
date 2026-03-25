import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "../models/User.js";
import Listing from "../models/Listing.js";

dotenv.config({ path: ".env.local" });

const MONGO_URI = process.env.MONGO_URI;

// ---------------------------
// FILL THESE OUT
// ---------------------------

const EXPECTED_CURRENT_OWNER_ID = "697cc532de07a3a8ce3eec9b";

const LANDLORD_TRANSFERS = [
  {
    landlord: {
      name: "Leslie Johnson",
      email: "lauren@mosaic314.com",
      phone: "3149740721", // optional
    },
    listingIds: ["69c343c695dd04862091f3f0", "69c34935f5a498af692569a0"],
  },
];

// ---------------------------

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function runTransfer() {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is missing from environment variables.");
  }

  if (!isValidObjectId(EXPECTED_CURRENT_OWNER_ID)) {
    throw new Error("EXPECTED_CURRENT_OWNER_ID is not a valid ObjectId.");
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB\n");

  const summary = {
    reusedUsers: [],
    createdUsers: [],
    transferredListings: [],
    skipped: [],
  };

  const seenEmails = new Map();

  for (const transfer of LANDLORD_TRANSFERS) {
    const { landlord, listingIds } = transfer;

    if (!landlord?.name || !landlord?.email) {
      summary.skipped.push({
        reason: "Missing landlord name or email",
        landlord,
        listingIds,
      });
      continue;
    }

    const normalizedEmail = landlord.email.toLowerCase().trim();
    let targetUser = null;

    if (seenEmails.has(normalizedEmail)) {
      targetUser = seenEmails.get(normalizedEmail);
    } else {
      const existingUser = await User.findOne({
        email: normalizedEmail,
      }).select("_id name email phone role listings");

      if (existingUser) {
        targetUser = existingUser;
        summary.reusedUsers.push({
          userId: existingUser._id.toString(),
          name: existingUser.name,
          email: existingUser.email,
        });
      } else {
        targetUser = await User.create({
          name: landlord.name,
          email: normalizedEmail,
          phone: landlord.phone || "N/A",
          role: "landlord",
          profileComplete: false,
        });

        summary.createdUsers.push({
          userId: targetUser._id.toString(),
          name: targetUser.name,
          email: targetUser.email,
        });
      }

      seenEmails.set(normalizedEmail, targetUser);
    }

    for (const listingId of listingIds) {
      if (!isValidObjectId(listingId)) {
        summary.skipped.push({
          reason: "Invalid listing ID",
          listingId,
          landlordEmail: normalizedEmail,
        });
        continue;
      }

      const listing = await Listing.findById(listingId).select(
        "_id address owner"
      );

      if (!listing) {
        summary.skipped.push({
          reason: "Listing not found",
          listingId,
          landlordEmail: normalizedEmail,
        });
        continue;
      }

      const currentOwnerId = listing.owner?.toString();

      if (currentOwnerId !== EXPECTED_CURRENT_OWNER_ID) {
        summary.skipped.push({
          reason: "Listing owner does not match EXPECTED_CURRENT_OWNER_ID",
          listingId: listing._id.toString(),
          address: listing.address,
          actualOwnerId: currentOwnerId || null,
          landlordEmail: normalizedEmail,
        });
        continue;
      }

      // 1) Update listing owner
      listing.owner = targetUser._id;
      await listing.save();

      // 2) Remove listing from your user.listings
      await User.updateOne(
        { _id: EXPECTED_CURRENT_OWNER_ID },
        { $pull: { listings: listing._id } }
      );

      // 3) Add listing to landlord user.listings (without duplicates)
      await User.updateOne(
        { _id: targetUser._id },
        { $addToSet: { listings: listing._id } }
      );

      summary.transferredListings.push({
        listingId: listing._id.toString(),
        address: listing.address,
        fromOwnerId: EXPECTED_CURRENT_OWNER_ID,
        toOwnerId: targetUser._id.toString(),
        toOwnerEmail: targetUser.email,
      });
    }
  }

  console.log("========== TRANSFER SUMMARY ==========\n");

  console.log("Reused users:");
  console.log(JSON.stringify(summary.reusedUsers, null, 2));

  console.log("\nCreated users:");
  console.log(JSON.stringify(summary.createdUsers, null, 2));

  console.log("\nTransferred listings:");
  console.log(JSON.stringify(summary.transferredListings, null, 2));

  console.log("\nSkipped items / warnings:");
  console.log(JSON.stringify(summary.skipped, null, 2));

  await mongoose.disconnect();
  console.log("\nDisconnected from MongoDB");
}

runTransfer().catch(async (error) => {
  console.error("Transfer failed:", error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
