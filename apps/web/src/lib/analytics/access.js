import { getDbRole } from "@/lib/userRole";

/*
 * Who can open /analytics, and which sections they see.
 *
 * - Admins and supers see every section, on every deployment.
 * - "Extra viewers" are outside partners (e.g. the WashU UX club) listed by email in
 *   ANALYTICS_EXTRA_VIEWERS (comma separated). Set that variable ONLY on the deployments
 *   a partner may use (the Preview env scoped to the `sandbox` branch). Everywhere else it
 *   is unset, so the same account gets a 404.
 * - Extra viewers see only the sections in EXTRA_VIEWER_SECTIONS. Sections they cannot see
 *   are never computed, so their numbers never leave the server.
 * - Everyone else gets a 404, so the page does not advertise that it exists.
 */

export const SECTIONS = [
  { key: "overview", title: "Overview" },
  { key: "matchmaking", title: "Matchmaking" },
  { key: "landlord", title: "Landlord flow" },
  { key: "engagement", title: "Listing engagement" },
  { key: "reviews", title: "Reviews" },
  { key: "leaseCheck", title: "Lease check" },
  { key: "traffic", title: "Traffic" },
];

// Sections an extra viewer may see. Add a key from SECTIONS to share more with partners.
export const EXTRA_VIEWER_SECTIONS = ["matchmaking", "landlord"];

const ADMIN_ROLES = new Set(["admin", "super"]);

function extraViewerEmails() {
  return (process.env.ANALYTICS_EXTRA_VIEWERS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Resolve what this session may see. Returns null when it may not open the page.
 * { isAdmin, sections: [{ key, title }] }
 */
export async function getAnalyticsViewer(session) {
  const email = session?.user?.email?.toLowerCase();
  if (!session?.user?.id || !email) return null;

  // DB role first: the token role can be stale after a promotion (see userRole.js).
  const role = (await getDbRole(email)) ?? session.user.role;
  if (ADMIN_ROLES.has(role)) return { isAdmin: true, sections: SECTIONS };

  if (extraViewerEmails().includes(email)) {
    return {
      isAdmin: false,
      sections: SECTIONS.filter((s) => EXTRA_VIEWER_SECTIONS.includes(s.key)),
    };
  }
  return null;
}
