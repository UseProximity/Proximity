import { getDbRole } from "@/lib/userRole";
import { TABS } from "@/lib/analytics/tabs";

/*
 * Who can open /analytics, and which tabs they see.
 *
 * - Admins and supers see every tab, on every deployment.
 * - "Extra viewers" are outside partners (e.g. the WashU UX club) listed by email in
 *   ANALYTICS_EXTRA_VIEWERS (comma separated). Set that variable ONLY on the deployments
 *   a partner may use (the Preview env scoped to the `sandbox` branch). Everywhere else it
 *   is unset, so the same account gets a 404.
 * - Extra viewers see only the tabs in EXTRA_VIEWER_TABS. Other tabs 404 for them and are
 *   never computed, so their numbers never leave the server.
 * - Everyone else gets a 404, so the page does not advertise that it exists.
 */

// Tabs an extra viewer may open, by slug from tabs/index.js. Add a slug to share more.
export const EXTRA_VIEWER_TABS = ["matchmaking", "landlords"];

const ADMIN_ROLES = new Set(["admin", "super"]);

function extraViewerEmails() {
  return (process.env.ANALYTICS_EXTRA_VIEWERS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve what this session may see. Returns null when it may not open the page.
 * { isAdmin, tabs: [{ slug, title, load }] }
 */
export async function getAnalyticsViewer(session) {
  const email = session?.user?.email?.toLowerCase();
  if (!session?.user?.id || !email) return null;

  // DB role first: the token role can be stale after a promotion (see userRole.js).
  const role = (await getDbRole(email)) ?? session.user.role;
  if (ADMIN_ROLES.has(role)) return { isAdmin: true, tabs: TABS };

  if (extraViewerEmails().includes(email)) {
    return { isAdmin: false, tabs: TABS.filter((t) => EXTRA_VIEWER_TABS.includes(t.slug)) };
  }
  return null;
}
