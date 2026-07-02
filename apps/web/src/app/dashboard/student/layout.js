import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDbRole } from "@/lib/userRole";

export default async function StudentDashboard({ children }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  // Resolve role from the DB (not the JWT) — a landlord with a stale `student`
  // token must still be bounced to their landlord dashboard.
  const role = (await getDbRole(session.user.email)) ?? session.user.role;
  if (role === "landlord") redirect("/dashboard/landlord");
  if (role === "admin") redirect("/dashboard/admin");

  return children;
}
