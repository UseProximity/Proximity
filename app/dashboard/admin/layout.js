import { auth } from "@/auth";
import { redirect } from "next/navigation";
import supabase from "@/libs/supabase";

export default async function AdminLayout({ children }) {
  const session = await auth();

  // First check: session role
  if (!session?.user?.email || session.user.role !== "super") {
    redirect("/");
  }

  // Second check: verify directly against the database — session alone can't be trusted
  const { data: dbUser } = await supabase
    .from("users")
    .select("role")
    .eq("email", session.user.email)
    .single();

  if (dbUser?.role !== "super") {
    redirect("/");
  }

  return children;
}
