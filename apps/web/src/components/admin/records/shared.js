"use client";

/*
 * Pieces shared by the admin record pages (PersonRecord, ListingRecord): the
 * card frame and the lists of conversations, tours and changes that both show.
 */
import { Badge } from "@/components/admin/adminShared";
import { AdminLink, ListingLink, PersonLink } from "@/components/admin/RecordLink";
import { dayText, isCalendarDay } from "@/utils/calendarDate";

// A plain date (a move-in date column) keeps the day it names; read as a
// moment it showed a day early in US time zones (PR 447 review).
export const day = (iso) =>
  !iso ? "" : isCalendarDay(iso) ? dayText(iso) : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
export const dayTime = (iso) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
export const personName = (p) => (p ? p.name || p.email || "Unnamed account" : "");

export function Card({ title, count, action, children, className = "" }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          {title}
          {count != null && <span className="ml-1.5 text-xs font-normal text-gray-500">({count})</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export const Empty = ({ children }) => <p className="text-sm text-gray-400">{children}</p>;

export function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="break-words text-sm text-gray-800">{children || <span className="text-gray-400">Not given</span>}</dd>
    </div>
  );
}

const LISTING_STATES = {
  published: ["green", "Published"],
  draft: ["amber", "Draft"],
  hidden: ["gray", "Hidden"],
  deleted: ["red", "Deleted"],
};

export function ListingStateBadge({ state }) {
  const [color, label] = LISTING_STATES[state] ?? ["gray", state];
  return <Badge color={color}>{label}</Badge>;
}

const TOUR_STATES = {
  requested: ["amber", "Waiting on the landlord"],
  proposed: ["amber", "Times proposed"],
  messaging: ["blue", "Landlord wrote instead"],
  confirmed: ["green", "Confirmed"],
  cancelled: ["gray", "Cancelled"],
  expired: ["gray", "Expired"],
};

/* Conversations, each opening in the Conversations page. `hide` drops a column the page already implies. */
export function ThreadList({ threads, hide }) {
  if (!threads?.length) return <Empty>No conversations.</Empty>;
  return (
    <ul className="divide-y divide-gray-100">
      {threads.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
          <Badge color={t.kind === "direct" ? "blue" : "purple"}>{t.kind === "direct" ? "Person to person" : "With Proxy"}</Badge>
          {hide !== "listing" && t.listing && <ListingLink id={t.listing.id}>{t.listing.label}</ListingLink>}
          {hide !== "student" && (t.student ? <PersonLink id={t.student.id}>{personName(t.student)}</PersonLink> : t.visitor ? <span className="text-gray-500">Signed-out visitor</span> : null)}
          {hide !== "landlord" && t.kind === "direct" && t.landlord && <span className="text-gray-500">with <PersonLink id={t.landlord.id}>{personName(t.landlord)}</PersonLink></span>}
          {t.deleted && <Badge color="red">deleted</Badge>}
          <span className="ml-auto flex items-center gap-3 text-xs text-gray-500">
            {dayTime(t.lastActivityAt)}
            <AdminLink path="conversations" params={{ tab: t.kind === "direct" ? "direct" : "agent", thread: t.id }} className="font-medium text-gray-900 underline">Open</AdminLink>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TourList({ tours, hide }) {
  if (!tours?.length) return <Empty>No tours.</Empty>;
  return (
    <ul className="divide-y divide-gray-100">
      {tours.map((t) => {
        const [color, label] = TOUR_STATES[t.status] ?? ["gray", t.status];
        return (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <Badge color={color}>{label}</Badge>
            {hide !== "listing" && t.listing && <ListingLink id={t.listing.id}>{t.listing.label}</ListingLink>}
            {hide !== "student" && t.student && <PersonLink id={t.student.id}>{personName(t.student)}</PersonLink>}
            {hide !== "landlord" && t.landlord && <span className="text-gray-500">with <PersonLink id={t.landlord.id}>{personName(t.landlord)}</PersonLink></span>}
            {t.confirmedSlot && <span className="text-gray-700">{dayTime(t.confirmedSlot)}</span>}
            {t.cancelReason && <span className="text-xs text-gray-500">&ldquo;{t.cancelReason}&rdquo;</span>}
            <span className="ml-auto flex items-center gap-3 text-xs text-gray-500">
              {dayTime(t.lastActivityAt)}
              {t.threadId && <AdminLink path="conversations" params={{ tab: "direct", thread: t.threadId }} className="font-medium text-gray-900 underline">Chat</AdminLink>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const EVENTS = { INSERT: "added", UPDATE: "changed", DELETE: "removed" };

/* The audit trail's most recent rows, in plain words. */
export function ActivityList({ rows, showWho = false }) {
  if (!rows?.length) return <Empty>Nothing recorded.</Empty>;
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5 text-sm">
          <span className="text-gray-800">
            {showWho && (a.by ? <><PersonLink id={a.by.id}>{personName(a.by)}</PersonLink>{" "}</> : "The system ")}
            {EVENTS[String(a.event ?? "").toUpperCase()] ?? String(a.event ?? "").toLowerCase()}{" "}
            <span className="text-gray-600">{String(a.table ?? "").replace(/_/g, " ")}</span>
          </span>
          {Array.isArray(a.fields) && a.fields.length > 0 && <span className="truncate text-xs text-gray-500">{a.fields.slice(0, 6).map((f) => f.replace(/_/g, " ")).join(", ")}{a.fields.length > 6 ? ` and ${a.fields.length - 6} more` : ""}</span>}
          <span className="ml-auto text-xs text-gray-500">{dayTime(a.at)}</span>
        </li>
      ))}
    </ul>
  );
}
