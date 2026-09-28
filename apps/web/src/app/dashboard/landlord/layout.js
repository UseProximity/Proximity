import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getDbRole } from "@/lib/userRole";
import { hasAnyStake } from "@/lib/listings/ownership";

/*
 * The door to the property dashboard.
 *
 * It admits a stake, not a job title. A student subletting their room holds a
 * lease exactly the way a landlord does — same table, same owner_id, same
 * property → unit → lease record — and every endpoint behind this screen
 * already authorizes on ownership rather than role. Only this gate asked what
 * you were rather than what you hold, which left a subletter with no way to
 * reach their own offering.
 *
 * Being let in is not permission to change anything: each level re-checks who
 * owns it, so a lease-holder who isn't the property owner sees the building's
 * record read-only and can edit only their own terms.
 */
export default async function LandlordDashboard({ children }) {
  const session = await auth();

  if (!session) {
    redirect("/");
  }

  // Resolve role from the DB (not the JWT) so a freshly-promoted landlord whose
  // token still says `student` isn't wrongly redirected away from this page.
  const role = (await getDbRole(session.user.email)) ?? session.user.role;
  if (role === "landlord" || role === "super") return children;

  // Not a landlord — but holding an offering anywhere is reason enough.
  if (await hasAnyStake(session.user.id)) return children;

  redirect("/dashboard/student");
}
