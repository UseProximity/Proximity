import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDbRole } from "@/lib/userRole";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/");
  // Resolve role from the DB (not the JWT) so a stale token role doesn't
  // misroute a freshly-promoted landlord to the student dashboard.
  const role = (await getDbRole(session.user.email)) ?? session.user.role;
  redirect(role === "landlord" ? "/dashboard/landlord" : "/dashboard/student");
}
