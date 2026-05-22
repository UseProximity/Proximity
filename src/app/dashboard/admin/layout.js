import { auth } from "@/auth";
import { redirect } from "next/navigation";
import supabase from "@/lib/supabase";

export default async function AdminLayout({ children }) {
  const session = await auth();

  // First check: session role
  const sessionRole = session?.user?.role;
  if (!session?.user?.email || (sessionRole !== "super" && sessionRole !== "admin")) {
    redirect("/");
  }

  // Second check: verify directly against the database — session alone can't be trusted
  const { data: dbUser } = await supabase
    .from("users")
    .select("roles!role_id(name)")
    .eq("email", session.user.email)
    .single();

  const dbRole = dbUser?.roles?.name;
  if (dbRole !== "super" && dbRole !== "admin") {
    redirect("/");
  }

  return children;
}
