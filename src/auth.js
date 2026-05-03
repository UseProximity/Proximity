/*
 * Authentication configuration for the entire application. Sets up NextAuth v5 with two
 * sign-in methods: Google OAuth (primary, used by most students) and email/password
 * Credentials (for accounts created without Google). On first Google sign-in a new user
 * row is inserted into Supabase with a default "student" role. On subsequent Google
 * sign-ins the google_account flag and profile image are kept in sync.
 *
 * The JWT callback caches userId, role, and profileComplete in the token so every
 * session() call is a zero-DB read. Role freshness is enforced by ROLE_REFRESH_MS (60s):
 * after that window the JWT callback re-fetches role and profileComplete from the DB so
 * admin-side role changes propagate without requiring a sign-out. The session callback
 * exposes those three fields to the client via session.user.
 *
 * Exports: handlers (GET/POST for /api/auth/*), signIn, signOut, auth (server-side
 * session getter used by layout.js and protected API routes).
 */
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import supabase from "@/lib/supabase";

// How long the JWT can trust its cached role before re-checking the DB.
// Short enough to heal stale sessions (e.g. role was changed in another
// tab / by an admin) without requiring a sign-out.
const ROLE_REFRESH_MS = 60_000;

const config = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
    }),
    Credentials({
      async authorize(credentials) {
        const { email, password } = credentials;
        if (!email || !password) return null;

        const { data: user } = await supabase
          .from("users")
          .select("id, email, name, password_hash, email_verified, profile_complete, roles!role_id(name)")
          .eq("email", email)
          .single();

        if (!user || !user.password_hash) return null;
        if (!user.email_verified) throw new Error("EMAIL_NOT_VERIFIED");

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  session: { strategy: "jwt" },
  allowDangerousEmailAccountLinking: true,
  pages: {
    error: "/",
  },
  callbacks: {
    async jwt({ token, user, account, trigger, session: updateData }) {
      // Credentials sign-in: user.id is the DB id returned from authorize()
      if (account?.provider === "credentials" && user?.id) {
        const { data: existing } = await supabase
          .from("users")
          .select("id, profile_complete, name, roles!role_id(name)")
          .eq("id", user.id)
          .single();
        if (existing) {
          token.userId = existing.id;
          token.role = existing.roles?.name ?? "student";
          token.profileComplete = existing.profile_complete ?? false;
          if (existing.name) token.name = existing.name;
          token.roleCheckedAt = Date.now();
        }
        return token;
      }

      // On sign-in: fetch user from DB once and cache in the token
      if (account?.provider === "google" && user?.email) {
        const image = user.image ?? null;

        const { data: existing } = await supabase
          .from("users")
          .select("id, profile_complete, name, roles!role_id(name)")
          .eq("email", user.email)
          .single();

        if (!existing) {
          const { data: studentRole } = await supabase
            .from("roles")
            .select("id")
            .eq("name", "student")
            .single();
          const { data: newUser, error } = await supabase
            .from("users")
            .insert({
              email: user.email,
              name: user.name || user.email.split("@")[0] || "New User",
              image,
              role_id: studentRole?.id,
              profile_complete: false,
              gender: "unspecified",
              phone: "N/A",
              description: "",
              referral_source: "",
              google_account: true,
            })
            .select("id")
            .single();
          if (error) console.error("jwt: failed to insert new user", error);
          token.userId = newUser?.id ?? null;
          token.role = "student";
          token.profileComplete = false;
          token.roleCheckedAt = Date.now();
        } else {
          const imageUpdate = image ? { image, google_account: true } : { google_account: true };
          const { error } = await supabase
            .from("users")
            .update(imageUpdate)
            .eq("email", user.email);
          if (error) console.error("jwt: failed to update user", error);
          token.userId = existing.id;
          token.role = existing.roles?.name ?? "student";
          token.profileComplete = existing.profile_complete ?? false;
          if (existing.name) token.name = existing.name;
          token.roleCheckedAt = Date.now();
        }
      }

      // Backfill old tokens issued before JWT caching was introduced
      if (!token.userId && token.email) {
        const { data: sbUser } = await supabase
          .from("users")
          .select("id, profile_complete, name, roles!role_id(name)")
          .eq("email", token.email)
          .single();
        if (sbUser) {
          token.userId = sbUser.id;
          token.role = sbUser.roles?.name ?? "student";
          token.profileComplete = sbUser.profile_complete ?? false;
          if (sbUser.name) token.name = sbUser.name;
          token.roleCheckedAt = Date.now();
        }
      }

      // Client called update({ profileComplete, role }) after profile completion
      if (trigger === "update") {
        if (updateData?.profileComplete !== undefined) {
          token.profileComplete = updateData.profileComplete;
        }
        if (updateData?.role !== undefined) {
          token.role = updateData.role;
          token.roleCheckedAt = Date.now();
        }
      }

      // Auto-heal stale role/profile_complete from DB.
      // Why: users can change their role via /api/editProfile (or an admin can
      // edit it server-side) without the JWT knowing. Without this refresh a
      // landlord whose role was flipped in the DB would keep seeing the student
      // UI until they sign out and back in.
      if (
        token.userId &&
        (!token.roleCheckedAt ||
          Date.now() - token.roleCheckedAt > ROLE_REFRESH_MS)
      ) {
        const { data: fresh, error: refreshErr } = await supabase
          .from("users")
          .select("profile_complete, roles!role_id(name)")
          .eq("id", token.userId)
          .single();
        if (!refreshErr && fresh) {
          token.role = fresh.roles?.name ?? token.role ?? "student";
          token.profileComplete =
            fresh.profile_complete ?? token.profileComplete ?? false;
        }
        token.roleCheckedAt = Date.now();
      }

      return token;
    },
    async session({ session, token }) {
      // Read from token — no DB hit
      session.user.id = token.userId;
      session.user.role = token.role ?? "student";
      session.user.profileComplete = token.profileComplete ?? false;
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
