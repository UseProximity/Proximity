import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import supabase from "@/libs/supabase";

const config = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  allowDangerousEmailAccountLinking: true,
  pages: {
    error: "/",
  },
  callbacks: {
    async jwt({ token, user, account, trigger, session: updateData }) {
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
            })
            .select("id")
            .single();
          if (error) console.error("jwt: failed to insert new user", error);
          token.userId = newUser?.id ?? null;
          token.role = "student";
          token.profileComplete = false;
        } else {
          if (image) {
            const { error } = await supabase
              .from("users")
              .update({ image })
              .eq("email", user.email);
            if (error) console.error("jwt: failed to update user image", error);
          }
          token.userId = existing.id;
          token.role = existing.roles?.name ?? "student";
          token.profileComplete = existing.profile_complete ?? false;
          if (existing.name) token.name = existing.name;
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
        }
      }

      // Client called update({ profileComplete: true }) after profile completion
      if (trigger === "update" && updateData?.profileComplete !== undefined) {
        token.profileComplete = updateData.profileComplete;
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
