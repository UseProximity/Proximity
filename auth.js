/*
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "./libs/mongo";

const config = {
  providers: [
    Resend({
      apiKey: process.env.RESEND_KEY,
      from: "noreply@resend.bookecho.org",
      name: "Email",
    }),
  ],
  adapter: MongoDBAdapter(clientPromise),
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
*/

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "./libs/mongo";
import connectMongo from "@/libs/mongoose";
import User from "@/models/User";

const config = {
  providers: [
    Resend({
      apiKey: process.env.RESEND_KEY,
      from: "noreply@resend.bookecho.org",
      name: "Email",
    }),
  ],
  adapter: MongoDBAdapter(clientPromise),
  events: {
    async createUser({ user }) {
      // Runs once after adapter creates the user
      await connectMongo();
      await User.updateOne(
        { _id: user.id },
        {
          $set: {
            age: 18,
            description: "",
            email: user.email ?? null,
            favorites: [],
            gender: "unspecified",
            image: user.image ?? null,
            name:
              user.name || (user.email ? user.email.split("@")[0] : "New User"),
            numReviews: 0,
            phone: "N/A",
            profileComplete: false,
            rating: 0,
            role: "student",
          },
        }
      );
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
