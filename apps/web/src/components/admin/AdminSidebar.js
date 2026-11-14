"use client";

import Link from "next/link";
import { hrefFor } from "@/components/admin/adminNav";

/*
 * The admin dashboard's left-hand menu. A group with a single page shows as one
 * link under the group's name; a group with several lists them beneath a heading.
 * Page links are real addresses (open in a new tab works), but a plain click is
 * handled in place so the dev/prod choice and unsaved edits are not lost.
 */

function isPlainClick(e) {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

function NavLink({ item, label, active, onNavigate, indent }) {
  const base = `block rounded-lg py-1.5 text-sm transition-colors ${indent ? "pl-5 pr-3" : "px-3 font-medium"}`;
  const tone = active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-200";

  if (item.external) {
    return (
      <Link href={hrefFor(item.path)} className={`${base} ${tone}`}>
        {label}
      </Link>
    );
  }
  return (
    <a
      href={hrefFor(item.path)}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        onNavigate(item.path);
      }}
      className={`${base} ${tone}`}
    >
      {label}
    </a>
  );
}

export default function AdminSidebar({ groups, activePath, onNavigate }) {
  return (
    <nav aria-label="Admin sections" className="hidden md:block w-52 flex-shrink-0 border-r border-gray-200 bg-gray-50">
      <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto px-3 pt-4 pb-20 space-y-3">
        {groups.map((group) =>
          group.items.length === 1 ? (
            <NavLink
              key={group.label}
              item={group.items[0]}
              label={group.label}
              active={group.items[0].path === activePath}
              onNavigate={onNavigate}
            />
          ) : (
            <div key={group.label}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.path}
                    item={item}
                    label={item.label}
                    active={item.path === activePath}
                    onNavigate={onNavigate}
                    indent
                  />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </nav>
  );
}
