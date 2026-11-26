import { auth } from "@/auth";
import { hasDbRole } from "@/lib/userRole";
import { UUID_RE, VIEW_AS_ROLES } from "@/lib/users/viewAs";

/*
 * Whose billing a READ on the landlord Billing tab is about (Wyatt, 2026-11-11):
 * an admin viewing as a landlord sees exactly what that landlord sees.
 *
 * Returns { userId, viewingAs } or null (forbidden):
 *   - a landlord reading their own billing: { userId: self, viewingAs: false }
 *   - a super or admin passing ?viewAs=<landlord id>: { userId: that landlord, viewingAs: true }
 *
 * Only GET handlers call this. Every billing write still takes the signed-in
 * user and requires the landlord role, so an admin viewing as someone cannot
 * act for them, and a read made while viewing as skips anything that would
 * change state (syncing from Documenso, finishing a takeover).
 */
export async function billingReader(req) {
  const session = await auth();
  const callerId = session?.user?.id;
  if (!callerId) return null;

  const viewAs = req ? new URL(req.url).searchParams.get("viewAs") : null;
  if (viewAs && viewAs !== callerId) {
    if (!UUID_RE.test(viewAs)) return null;
    if (!(await hasDbRole(callerId, VIEW_AS_ROLES))) return null;
    if (!(await hasDbRole(viewAs, ["landlord"]))) return null;
    return { userId: viewAs, viewingAs: true };
  }

  return (await hasDbRole(callerId, ["landlord"])) ? { userId: callerId, viewingAs: false } : null;
}
