/*
 * The admin dashboard's map (Wyatt, 2026-11-12). Each page has its own address
 * under /dashboard/admin, grouped by the job it serves rather than by database
 * table. The sidebar, the mobile page picker and the old-link redirects all read
 * from here, so a page is added or moved in one place.
 *
 *   path       the address after /dashboard/admin/
 *   hierarchy  the page is one table view loaded from /api/admin/hierarchy/<name>
 *   superOnly  hidden from the read-only admin role
 *   pinned     the page ignores the dev/prod switch and always uses this site's
 *              own database; the shell says so when the switch points elsewhere
 */

export const ADMIN_BASE = "/dashboard/admin";
export const DEFAULT_PATH = "listings";

export const NAV = [
  {
    label: "People",
    items: [{ path: "people/users", label: "All users", hierarchy: "users" }],
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
    items: [{ path: "conversations", label: "Conversations and tours" }],
  },
  {
    label: "Reviews",
    items: [
      { path: "reviews", label: "Listing reviews", hierarchy: "reviews" },
      { path: "reviews/invites", label: "Review invites", pinned: true },
      { path: "reviews/testimonials", label: "Testimonials", hierarchy: "testimonials" },
    ],
  },
  {
    label: "Billing",
    items: [{ path: "billing", label: "Billing", superOnly: true }],
  },
  {
    label: "Agents and sync",
    items: [{ path: "agents", label: "Agents", pinned: true }],
  },
  {
    label: "Email",
    items: [
      { path: "email/sent", label: "Sent emails" },
      { path: "email/mass", label: "Mass email", superOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      { path: "system/errors", label: "Errors" },
      { path: "system/reference", label: "Reference data", hierarchy: "reference" },
      { path: "system/tools", label: "Tools" },
      { path: "export", label: "CSV export", external: true },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((g) => g.items.map((item) => ({ ...item, group: g.label })));

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

export function hrefFor(path) {
  return `${ADMIN_BASE}/${path}`;
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
