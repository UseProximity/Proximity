import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "./libs/mongo";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

const config = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
    }),
  ],
  adapter: MongoDBAdapter(clientPromise),
  allowDangerousEmailAccountLinking: true,
  pages: {
    error: "/",
  },
  events: {
    async createUser({ user }) {
      // Runs once after adapter creates the user
      await connectMongo();
      await User.updateOne(
        { _id: user.id },
        {
          $set: {
            createdAt: new Date(),
            description: "",
            email: user.email ?? null,
            favorites: [],
            gender: "unspecified",
            image: user.image ?? null,
            listings: [],
            name:
              user.name || (user.email ? user.email.split("@")[0] : "New User"),
            numReviews: 0,
            phone: "N/A",
            profileComplete: false,
            rating: 0,
            referralSource: "",
            reviews: [],
            role: "student",
          },
        }
      );
    },
    async signIn({ user, profile, account }) {
      // Keep profile image in sync for Google sign-ins
      if (account?.provider !== "google") return;
      const image =
        user?.image || profile?.picture || profile?.image || null;
      if (!image) return;
      await connectMongo();
      await User.updateOne(
        { _id: user.id },
        { $set: { image } }
      );
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
