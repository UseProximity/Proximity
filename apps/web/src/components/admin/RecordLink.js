"use client";

import { useAdminNav } from "@/components/admin/adminShared";
import { hrefFor, listingPath, personPath } from "@/components/admin/adminNav";

/*
 * Links between admin pages. Each is a real address (open in a new tab works);
 * a plain click moves in place so the dev/prod choice is kept. Anywhere a
 * person or a listing is named, use PersonLink or ListingLink so the name
 * opens their record.
 */

const plain = (e) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
const LINK = "text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-700";

export function AdminLink({ path, params, className = LINK, title, children }) {
  const nav = useAdminNav();
  return (
    <a
      href={hrefFor(path, params)}
      title={title}
      className={className}
      onClick={(e) => {
        // Rows that expand on click should not also expand when a link in them is used.
        e.stopPropagation();
        if (!nav || !plain(e)) return;
        e.preventDefault();
        nav.goTo(path, params);
      }}
    >
      {children}
    </a>
  );
}

export function PersonLink({ id, className, children }) {
  if (!id) return <>{children}</>;
  return <AdminLink path={personPath(id)} className={className} title="Open their record">{children}</AdminLink>;
}

export function ListingLink({ id, className, children }) {
  if (!id) return <>{children}</>;
  return <AdminLink path={listingPath(id)} className={className} title="Open this listing's record">{children}</AdminLink>;
}
