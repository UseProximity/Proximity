/*
 * Who a dashboard request is actually ABOUT.
 *
 * An admin can open any landlord's dashboard through "view as", and every
 * endpoint behind that dashboard has to answer for the landlord rather than for
 * the admin reading it. Each one resolved that for itself, and they disagreed:
 * /api/admin/viewUser admitted "super" and "admin", while the metrics, reviews
 * and listings routes admitted "super" alone. So an admin viewing as a landlord
 * got the landlord's properties beside their own traffic figures and their own
 * reviews, presented as the landlord's, with nothing on screen to say the two
 * halves came from different people. Two of the three routes 403'd them
 * outright first, which is the only reason it was survivable.
 *
 * One rule, imported everywhere, so they cannot disagree again.
 */

/** Roles that may look at somebody else's dashboard. Both are read-only here. */
const VIEW_AS_ROLES = ["super", "admin"];

export const canViewAs = (role) => VIEW_AS_ROLES.includes(role);

/**
 * The user id a dashboard endpoint should report on: the `viewAs` target when
 * an admin asked for one, and the caller themselves otherwise. A non-admin
 * passing `viewAs` is quietly given their own id, which is the safe reading and
 * the one every one of these routes already used.
 */
export function resolveDashboardUserId(session, searchParams) {
  const viewAsId = searchParams?.get("viewAs");
  return viewAsId && canViewAs(session?.user?.role) ? viewAsId : session?.user?.id;
}
