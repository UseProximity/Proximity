"use client";

/*
 * One listing's record in the admin dashboard (Wyatt, 2026-11-12): its state,
 * its owners, the editor for units, leases, photos and amenities (the same one
 * the Listings page expands), and everything around it: agent, website sync,
 * conversations, tours, coverage, notes. Each item links on to its own page.
 */
import { useCallback, useEffect, useState } from "react";
import { adminFetch, Badge, GearButton, InlineToggle } from "@/components/admin/adminShared";
import { AdminLink, PersonLink } from "@/components/admin/RecordLink";
import { availability, ListingDetail } from "@/components/admin/ListingsView";
import NotesPanel from "@/components/admin/records/NotesPanel";
import { ActivityList, Card, day, dayTime, Empty, Fact, ListingStateBadge, personName, ThreadList, TourList } from "@/components/admin/records/shared";

const AGENT = { on: ["green", "Agent on"], pilot: ["blue", "Agent in pilot"], off: ["gray", "Agent off"] };
const SYNC_BAD = new Set(["fetch_failed", "parse_failed", "gone", "url_stale"]);
const COVERAGE = { covered: "green", proposed: "amber", released: "gray" };

export default function ListingRecord({ id, dbTarget, isProd, isReadOnly, refreshKey, onOpenGear, onOpenImages, onRefresh }) {
  const [row, setRow] = useState(null);
  const [extra, setExtra] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [rows, record] = await Promise.all([
        adminFetch(`/api/admin/hierarchy/listings?id=${id}`, dbTarget),
        adminFetch(`/api/admin/records/listing/${id}`, dbTarget),
      ]);
      setRow(Array.isArray(rows) ? rows[0] ?? null : null);
      setExtra(record);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [id, dbTarget]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // Names and emails for the "add landlord" picker, as on the Listings page.
  useEffect(() => {
    adminFetch("/api/admin/hierarchy/users?fields=picker", dbTarget)
      .then((users) => setAllUsers((users || []).map((u) => ({ id: u.id, name: u.name, email: u.email }))))
      .catch(() => setAllUsers([]));
  }, [dbTarget]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!row || !extra) return <div className="py-20 text-center text-sm text-gray-400">Loading record...</div>;

  const { listing, agent, monitors, threads, tours, questions, numbers, coverage, activity, hiddenPrices = [] } = extra;
  const avail = availability(row);
  const owners = row.listing_landlords || [];
  const openQuestions = questions.open ?? 0;
  // The shell's refresh bumps refreshKey, which loads this page again.
  const refresh = () => (onRefresh ? onRefresh() : load());

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">
        <AdminLink path="listings" className="underline">All listings</AdminLink> / {listing.label}
      </div>

      {listing.state === "deleted" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          This listing was deleted on {day(row.deleted_at)}. Students cannot see it.
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-gray-900">{listing.label}</h2>
            {row.title && <p className="text-sm text-gray-600">{row.address}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <ListingStateBadge state={listing.state} />
              {listing.state === "published" && <Badge color={avail.color}>{avail.label}</Badge>}
              {listing.test && <Badge color="purple" title="Made by an app store review account; hidden from real students">test listing</Badge>}
              {agent && <Badge color={AGENT[agent.status]?.[0]}>{AGENT[agent.status]?.[1] ?? agent.status}</Badge>}
            </div>
            <p className="mt-2 text-sm text-gray-700">
              {owners.length === 0 ? <span className="text-amber-700">No landlord account owns this listing.</span> : (
                <>Owned by{" "}
                  {owners.map((o, i) => (
                    <span key={o.user_id}>{i > 0 ? ", " : ""}<PersonLink id={o.user_id}>{personName(o.users)}</PersonLink>{o.is_primary && owners.length > 1 ? " (primary)" : ""}</span>
                  ))}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {listing.state === "published" && !listing.test && (
              <a href={`/listings/${listing.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">Public page</a>
            )}
            <InlineToggle table="listings" id={row.id} field="unavailable" value={row.unavailable} disabled={isReadOnly} label="Hide" />
            <span title="Edit this listing's fields"><GearButton onClick={() => onOpenGear("listings", row)} /></span>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
          <Fact label="Created">{day(listing.created_at)}</Fact>
          <Fact label="Published">{listing.published_at ? day(listing.published_at) : "Not yet (draft)"}</Fact>
          <Fact label="Contact on the listing">{[listing.contact_name, listing.contact_email].filter(Boolean).join(", ")}</Fact>
          <Fact label="Last 30 days">{`${numbers.clicks} opens, ${numbers.saves} saves, ${numbers.contacts} contacts`}</Fact>
          <Fact label="Id"><span className="font-mono text-xs">{listing.id}</span></Fact>
        </dl>
      </section>

      <NotesPanel subjectType="listing" subjectId={listing.id} dbTarget={dbTarget} />

      <Card title="Units, leases, owners and photos">
        <ListingDetail listing={row} allUsers={allUsers} dbTarget={dbTarget} isProd={isProd} isReadOnly={isReadOnly} onOpenGear={onOpenGear} onOpenImages={onOpenImages} onRefresh={refresh} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Agent" action={<AdminLink path="agents" params={{ tab: "knowledge" }} className="text-xs text-gray-600 underline">Open Knowledge</AdminLink>}>
          {!agent ? <Empty>No agent set up for this listing.</Empty> : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Status">{AGENT[agent.status]?.[1] ?? agent.status}</Fact>
              <Fact label="Facts it knows">{String(agent.facts)}</Fact>
              <Fact label="Seeded">{agent.seededAt ? day(agent.seededAt) : "Never"}</Fact>
              <Fact label="Questions waiting on the landlord">{String(openQuestions)}</Fact>
            </dl>
          )}
        </Card>

        <Card title="Website sync" count={monitors.length}>
          {monitors.length === 0 ? <Empty>No website is being watched for this listing.</Empty> : (
            <ul className="space-y-2">
              {monitors.map((m) => (
                <li key={m.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={!m.enabled ? "gray" : SYNC_BAD.has(m.status) ? "red" : "green"}>{!m.enabled ? "off" : String(m.status ?? "not checked yet").replace(/_/g, " ")}</Badge>
                    {m.failures > 0 && <Badge color="red">{m.failures} failure{m.failures === 1 ? "" : "s"} in a row</Badge>}
                    <span className="ml-auto text-xs text-gray-500">{m.checkedAt ? `checked ${dayTime(m.checkedAt)}` : "never checked"}</span>
                  </div>
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-gray-600 underline">{m.url}</a>
                  {m.error && <p className="text-xs text-red-700">{m.error}</p>}
                </li>
              ))}
            </ul>
          )}
          {hiddenPrices.length > 0 && <HiddenPrices prices={hiddenPrices} />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Conversations" count={threads.length}>
          <ThreadList threads={threads} hide="listing" />
        </Card>
        <Card title="Tours" count={tours.length}>
          <TourList tours={tours} hide="listing" />
        </Card>
      </div>

      {coverage && (
        <Card title="Agreement coverage" count={coverage.length} action={<AdminLink path="billing" params={{ tab: "agreements" }} className="text-xs text-gray-600 underline">Open Billing</AdminLink>}>
          {coverage.length === 0 ? <Empty>No signed agreement covers this listing.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {coverage.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <Badge color={COVERAGE[c.status] ?? "gray"}>{c.status}</Badge>
                  <PersonLink id={c.owner.id}>{personName(c.owner)}</PersonLink>
                  <span className="text-xs text-gray-500">{c.wholeBuilding ? "whole building" : Array.isArray(c.units) && c.units.length ? `units ${c.units.join(", ")}` : ""}</span>
                  <span className="ml-auto text-xs text-gray-500">{c.coveredAt ? `since ${day(c.coveredAt)}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card title="Recent changes to this listing" count={activity.length}>
        <ActivityList rows={activity} showWho />
      </Card>
    </div>
  );
}

/*
 * Website prices the sync keeps hidden on unpriced leases (Wyatt, 2026-11-20).
 * Admins only: matchmaking ranks with them and Proxy gives a rough range, but
 * students and landlords never see the figures.
 */
function HiddenPrices({ prices }) {
  const money = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-700">Website prices (hidden)</p>
      <p className="mb-1.5 text-xs text-gray-500">Used for matching only. Students and landlords never see these.</p>
      <ul className="space-y-1">
        {prices.map((p) => (
          <li key={p.leaseId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-800">{p.unit}</span>
            <span className="font-medium text-gray-900">
              {money(p.rent)}
              {p.perPerson === true ? "/person" : p.perPerson === false ? "/unit" : ""}
            </span>
            {p.overridden && <Badge color="gray">landlord price set</Badge>}
            {p.withdrawn && <Badge color="gray">withdrawn</Badge>}
            {p.stale && !p.overridden && <Badge color="amber">stale, unused</Badge>}
            <span className="ml-auto text-xs text-gray-500">seen {dayTime(p.seenAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
