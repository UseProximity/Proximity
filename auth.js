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
    async jwt({ token, user, account }) {
      // Fires on every OAuth sign-in (account is set) or token refresh (account is null)
      if (account?.provider === "google" && user?.email) {
        const image = user.image ?? null;

        const { data: existing } = await supabase
          .from("users")
          .select("id")
          .eq("email", user.email)
          .single();

        if (!existing) {
          // New user — insert with all defaults
          const { error } = await supabase.from("users").insert({
            email: user.email,
            name: user.name || user.email.split("@")[0] || "New User",
            image,
            role: "student",
            profile_complete: false,
            gender: "unspecified",
            phone: "N/A",
            description: "",
            referral_source: "",
          });
          if (error) console.error("jwt: failed to insert new user", error);
        } else if (image) {
          // Existing user — keep profile image in sync
          const { error } = await supabase
            .from("users")
            .update({ image })
            .eq("email", user.email);
          if (error) console.error("jwt: failed to update user image", error);
        }
      }
      return token;
    },
    async session({ session }) {
      if (session?.user?.email) {
        const { data: sbUser } = await supabase
          .from("users")
          .select("id, role, profile_complete, name")
          .eq("email", session.user.email)
          .single();
        if (sbUser) {
          session.user.id = sbUser.id;
          session.user.role = sbUser.role ?? "student";
          session.user.profileComplete = sbUser.profile_complete ?? false;
          if (sbUser.name) session.user.name = sbUser.name;
        } else {
          session.user.role = "student";
          session.user.profileComplete = false;
        }
      }
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
