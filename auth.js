/*import NextAuth from "next-auth";
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

export const { handlers, signIn, signOut, auth } = NextAuth(config);*/
/*
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
      // Ensure the auth-created doc has your defaults and profileComplete=false
      await connectMongo();
      await User.findOneAndUpdate(
        { _id: user.id },
        {
          $setOnInsert: {
            favorites: [],
            profileComplete: false,
          },
          $set: {
            name:
              user.name || (user.email ? user.email.split("@")[0] : "New User"),
            email: user.email ?? null,
            image: user.image ?? null,
            role: "student",
            gender: "unspecified",
            age: 18,
          },
        },
        { upsert: true, new: true }
      );
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);*/

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
            favorites: [],
            profileComplete: false,
            name:
              user.name || (user.email ? user.email.split("@")[0] : "New User"),
            email: user.email ?? null,
            image: user.image ?? null,
            role: "student",
            gender: "unspecified",
            age: 18,
          },
        }
      );
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
