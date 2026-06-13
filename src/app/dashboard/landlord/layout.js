import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDbRole } from "@/lib/userRole";

export default async function LandlordDashboard({ children }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  // Resolve role from the DB (not the JWT) so a freshly-promoted landlord whose
  // token still says `student` isn't wrongly redirected away from this page.
  const role = (await getDbRole(session.user.email)) ?? session.user.role;
  if (role !== "landlord" && role !== "super") {
    redirect("/");
  }

  return children;
}
