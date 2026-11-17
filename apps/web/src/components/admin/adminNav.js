/*
 * The admin dashboard's map (Wyatt, 2026-11-12). Each page has its own address
 * under /dashboard/admin, grouped by the job it serves rather than by database
 * table. The sidebar, the mobile page picker and the old-link redirects all read
 * from here, so a page is added or moved in one place.
 *
 *   path       the address after /dashboard/admin/
 *   hierarchy  the page is one table view loaded from /api/admin/hierarchy/<name>
 *   superOnly  hidden from the read-only admin role
 *   lists      the page is one or more plain lists from lib/admin/lists.js,
 *              shown as tabs when there are several
 *   pinned     the page ignores the dev/prod switch and always uses this site's
 *              own database; the shell says so when the switch points elsewhere
 */

export const ADMIN_BASE = "/dashboard/admin";
export const DEFAULT_PATH = "home";

export const NAV = [
  {
    label: "Home",
    items: [{ path: "home", label: "Home" }],
  },
  {
    label: "People",
    items: [
      { path: "people/landlords", label: "Landlords", hierarchy: "users", role: "landlord" },
      { path: "people/students", label: "Students", hierarchy: "users", role: "student" },
      { path: "people/users", label: "All users", hierarchy: "users" },
      {
        path: "people/activity",
        label: "Student activity",
        lists: [
          { list: "matchmaking-sessions", label: "Find Your Place searches" },
          { list: "lease-checks", label: "Lease checks" },
          { list: "waitlist", label: "Waitlist" },
        ],
      },
    ],
  },
  {
    label: "Listings",
    items: [
      { path: "listings", label: "All listings", hierarchy: "listings" },
      { path: "listings/unowned", label: "Without an account", superOnly: true },
      { path: "listings/duplicates", label: "Possible duplicates" },
      { path: "listings/dorms", label: "Dorms", hierarchy: "dorms" },
    ],
  },
  {
    label: "Conversations",
    items: [
      { path: "conversations", label: "Conversations and tours" },
      { path: "conversations/held", label: "Held email replies", lists: [{ list: "held-replies", label: "Held email replies" }] },
      {
        path: "conversations/safety",
        label: "Flags and reports",
        lists: [
          { list: "chat-flags", label: "Flagged messages" },
          { list: "chat-reports", label: "Reported chats" },
          { list: "listing-reports", label: "Reported listings" },
          { list: "review-reports", label: "Reported reviews" },
          { list: "reply-reports", label: "Reported replies" },
          { list: "user-blocks", label: "Blocks" },
        ],
      },
    ],
  },
  {
    label: "Reviews",
    items: [
      { path: "reviews", label: "Listing reviews", hierarchy: "reviews" },
      { path: "reviews/invites", label: "Review invites", pinned: true },
      { path: "reviews/referrals", label: "Referrals" },
      { path: "reviews/testimonials", label: "Testimonials", hierarchy: "testimonials" },
    ],
  },
  {
    label: "Billing",
    items: [{ path: "billing", label: "Billing", superOnly: true }],
  },
  {
    label: "Agents and sync",
    items: [
      { path: "agents", label: "Agents", pinned: true },
      {
        path: "agents/health",
        label: "Imports and sync health",
        lists: [
          { list: "import-jobs", label: "Imports and syncs" },
          { list: "sync-monitors", label: "Websites watched" },
          { list: "agent-questions", label: "Questions to landlords" },
          { list: "agent-usage", label: "Agent spend" },
        ],
      },
      {
        path: "agents/pms",
        label: "PMS connections",
        lists: [
          { list: "pms-connections", label: "Connections" },
          { list: "pms-queue", label: "Held for review" },
          { list: "pms-events", label: "Sync events" },
          { list: "pms-requests", label: "Systems asked for" },
        ],
      },
    ],
  },
  {
    label: "Email",
    items: [
      { path: "email/sent", label: "Sent emails" },
      { path: "email/mass", label: "Mass email", superOnly: true },
      {
        path: "email/suppressions",
        label: "Suppressions",
        lists: [
          { list: "email-suppressions", label: "Suppressed addresses" },
          { list: "email-unsubscribes", label: "Unsubscribed" },
        ],
      },
    ],
  },
  {
    label: "System",
    items: [
      { path: "system/errors", label: "Errors" },
      { path: "system/jobs", label: "Scheduled jobs", lists: [{ list: "scheduled-jobs", label: "Scheduled jobs" }] },
      { path: "system/activity", label: "Activity log", lists: [{ list: "activity", label: "Activity log" }] },
      { path: "system/reference", label: "Reference data", hierarchy: "reference" },
      { path: "system/tools", label: "Tools" },
      { path: "export", label: "CSV export", external: true, superOnly: true },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items.map((item) => ({ ...item, group: g.label })));

/*
 * Record pages: one person or one listing, at people/<id> and listings/<id>.
 * They are not in the sidebar; lists, search and links open them.
 */
const RECORD = /^(people|listings)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function recordFromPath(path) {
  const m = RECORD.exec(path ?? "");
  if (!m) return null;
  return m[1] === "people" ? { kind: "user", id: m[2], listPath: "people/users" } : { kind: "listing", id: m[2], listPath: "listings" };
}

export const personPath = (id) => `people/${id}`;
export const listingPath = (id) => `listings/${id}`;
export const isAdminPath = (path) => !!findNavItem(path) || !!recordFromPath(path);

export function findNavItem(path) {
  return ALL_ITEMS.find((i) => !i.external && i.path === path) ?? null;
}

// What to call a page in a heading or the mobile picker: a group with one page
// goes by the group's name.
export function navItemTitle(item) {
  const group = NAV.find((g) => g.label === item.group);
  return group && group.items.length === 1 ? group.label : item.label;
}

export function navGroupsFor(isSuper) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.superOnly || isSuper) })).filter((g) => g.items.length > 0);
}

// "/dashboard/admin/reviews/invites/" -> "reviews/invites"; the bare address -> "".
export function pathFromPathname(pathname) {
  if (!pathname || !pathname.startsWith(ADMIN_BASE)) return "";
  return pathname.slice(ADMIN_BASE.length).replace(/^\/+|\/+$/g, "");
}

export function hrefFor(path, params) {
  const qs = params ? new URLSearchParams(params).toString() : "";
  return `${ADMIN_BASE}/${path}${qs ? `?${qs}` : ""}`;
}

// Before the sidebar every page was ?view=<name> on one address. Emails already
// sent and saved bookmarks still use that, so they are sent on to the new page.
const LEGACY_VIEWS = {
  listings: "listings",
  users: "people/users",
  reviews: "reviews",
  dorms: "listings/dorms",
  testimonials: "reviews/testimonials",
  reference: "system/reference",
  invites: "reviews/invites",
  conversations: "conversations",
  emails: "email/sent",
  "mass-email": "email/mass",
  billing: "billing",
  agents: "agents",
  errors: "system/errors",
};

/*
 * Where an old-style address should land, or null when it is already a new one.
 * Returns { path, params } with the old-only params removed and the rest kept
 * (tab, thread, error and so on still mean the same thing on the new page).
 */
export function resolveLegacy(search) {
  const p = new URLSearchParams(search);
  const view = p.get("view");
  let path = null;

  if (view && LEGACY_VIEWS[view]) {
    path = LEGACY_VIEWS[view];
    // "Listings without an account" used to be a tab of Mass email.
    if (view === "mass-email" && p.get("tab") === "unowned") {
      path = "listings/unowned";
      p.delete("tab");
    }
  } else if (p.get("table") === "reviews") {
    // The student dashboard's old "Pending Reviews" link.
    path = "reviews";
    if (p.get("filter") === "pending") p.set("filter", "unverified");
  } else if (p.get("listing")) {
    // Website sync emails link straight to one listing.
    path = "listings";
  }

  if (!path) return null;
  p.delete("view");
  p.delete("table");
  return { path, params: p };
}
