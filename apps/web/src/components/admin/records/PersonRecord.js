"use client";

/*
 * One person's record in the admin dashboard (Wyatt, 2026-11-12): who they are,
 * where they stand, and everything attached to them (listings, billing,
 * conversations, tours, reviews, emails, notes) on one page, each item linking
 * on to its own page. Data comes from /api/admin/records/user/[id].
 */
import { useEffect, useState } from "react";
import { adminFetch, Badge, fmtMoney, GearButton, prodConfirm, Stars } from "@/components/admin/adminShared";
import { AdminLink, ListingLink } from "@/components/admin/RecordLink";
import NotesPanel from "@/components/admin/records/NotesPanel";
import { ActivityList, Card, day, dayTime, Empty, Fact, ListingStateBadge, personName, ThreadList, TourList } from "@/components/admin/records/shared";

const ROLE_COLORS = { super: "red", admin: "purple", landlord: "blue" };
const EMAIL_PROBLEMS = new Set(["bounced", "complained", "rejected", "failed"]);

// "3 searches, 1 mobile chat, last Nov 12": Find Your Place searches and the
// mobile app's Proxy chats, which share one table.
function sessionsSummary({ total, searches = 0, recent }) {
  if (!total) return "0";
  const chats = total - searches;
  const parts = [];
  if (searches) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  if (chats) parts.push(`${chats} mobile ${chats === 1 ? "chat" : "chats"}`);
  return `${parts.join(", ")}, last ${day(recent[0]?.updatedAt)}`;
}

const AGREEMENT = {
  signed: ["green", "Agreement signed"],
  needs_resign: ["amber", "Needs to sign the new version"],
  expired: ["red", "Agreement expired"],
  in_progress: ["amber", "Signing in progress"],
  not_signed: ["gray", "Agreement not signed"],
};
const PAYMENT = {
  active: ["green", "Payment method set"],
  verifying: ["amber", "Payment method verifying"],
  attention: ["red", "Payment method needs attention"],
  none: ["gray", "No payment method"],
};

function BillingCard({ id, dbTarget }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    adminFetch(`/api/admin/records/user/${id}?part=billing`, dbTarget)
      .then((d) => !cancelled && setState({ billing: d.billing }))
      .catch((e) => !cancelled && setState({ error: e.message }));
    return () => { cancelled = true; };
  }, [id, dbTarget]);

  const b = state.billing;
  return (
    <Card title="Billing" action={<AdminLink path="billing" params={{ tab: "agreements" }} className="text-xs text-gray-600 underline">Open Billing</AdminLink>}>
      {state.loading && <Empty>Loading billing...</Empty>}
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {!state.loading && !state.error && !b && <Empty>Not on the billing list (not an active landlord account).</Empty>}
      {b && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <Badge color={AGREEMENT[b.agreement?.status]?.[0]}>{AGREEMENT[b.agreement?.status]?.[1] ?? b.agreement?.status}</Badge>
            <Badge color={PAYMENT[b.payment?.state]?.[0]}>{PAYMENT[b.payment?.state]?.[1] ?? b.payment?.state}</Badge>
            <Badge color={b.publishing?.allowed ? "green" : "red"}>{b.publishing?.allowed ? "Can publish" : `Blocked: missing ${(b.publishing?.missing ?? []).join(", ").replace(/_/g, " ")}`}</Badge>
            {b.autopay && <Badge color="blue">Autopay on</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Fact label="Signed">{b.agreement?.signedAt ? `${day(b.agreement.signedAt)}${b.agreement.signerName ? ` by ${b.agreement.signerName}` : ""}` : "Not signed"}</Fact>
            <Fact label="Commission">{b.agreement?.commissionRatePercent != null ? `${b.agreement.commissionRatePercent}%` : "Standard"}</Fact>
            <Fact label="Unpaid invoices">{b.invoices?.unpaidCount ? `${b.invoices.unpaidCount} (${fmtMoney((b.invoices.unpaidCents ?? 0) / 100)})${b.invoices.overdue ? ", overdue" : ""}` : "None"}</Fact>
            <Fact label="Properties covered">{`${b.coverage.covered} covered${b.coverage.uncovered ? `, ${b.coverage.uncovered} not covered` : ""}`}</Fact>
            <Fact label="Authorized signer">{b.payer ? `${b.payer.name ?? b.payer.email ?? "Set"}${b.payer.declined ? " (declined)" : ""}` : "Signs for themselves"}</Fact>
            <Fact label="Pays for">{b.paysForCount ? `${b.paysForCount} other account${b.paysForCount === 1 ? "" : "s"}` : "Only themselves"}</Fact>
          </dl>
        </div>
      )}
    </Card>
  );
}

/* A landlord's listings. Deleted ones are tucked away so the live ones are not buried. */
function OwnedListings({ listings }) {
  const [showDeleted, setShowDeleted] = useState(false);
  const kept = listings.filter((l) => l.state !== "deleted");
  const deleted = listings.length - kept.length;
  const shown = showDeleted ? listings : kept;
  return (
    <Card
      title="Listings"
      count={kept.length}
      action={deleted > 0 ? <button type="button" onClick={() => setShowDeleted((v) => !v)} className="text-xs text-gray-600 underline">{showDeleted ? "Hide deleted" : `Show ${deleted} deleted`}</button> : null}
    >
      {shown.length === 0 ? <Empty>No listings.</Empty> : (
        <ul className="divide-y divide-gray-100">
          {shown.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
              <ListingLink id={l.id}>{l.label}</ListingLink>
              <ListingStateBadge state={l.state} />
              {l.primary && <Badge color="blue">primary owner</Badge>}
              {l.test && <Badge color="purple">test</Badge>}
              {l.minRent != null && <span className="ml-auto text-xs text-gray-500">{fmtMoney(l.minRent)}{l.maxRent && l.maxRent !== l.minRent ? ` to ${fmtMoney(l.maxRent)}` : ""}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/*
 * The changes a super admin makes to an account, as buttons with a plain
 * confirmation. Each used to mean typing a raw value into the gear drawer.
 */
const ROLE_CHOICES = ["student", "landlord", "parent", "other", "admin", "super"];

function AccountActions({ user, flags, role, dbTarget, isProd, ownDatabase, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function run(body, question, done) {
    if (!confirm(question)) return;
    if (!prodConfirm(isProd, "Change this account on the PRODUCTION database.")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await adminFetch(`/api/admin/users/${user.id}`, dbTarget, { method: "PATCH", body: JSON.stringify(body) });
      setNotice(done(r));
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const name = personName(user);
  const BTN = "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-40";
  return (
    <Card title="Account actions">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          Role
          <select
            value={role}
            disabled={busy}
            onChange={(e) => run({ action: "setRole", role: e.target.value }, `Change ${name} from ${role} to ${e.target.value}? They may need to sign in again to see the change.`, () => "Role changed.")}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
          >
            {[...new Set([role, ...ROLE_CHOICES])].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} className={BTN} onClick={() => run({ action: "setEmailAlerts", on: user.email_notifications === false }, user.email_notifications === false ? `Turn email alerts back on for ${name}?` : `Turn email alerts off for ${name}? They will stop getting chat alerts by email.`, () => "Email alerts updated.")}>
          {user.email_notifications === false ? "Turn email alerts on" : "Turn email alerts off"}
        </button>
        <button type="button" disabled={busy} className={BTN} onClick={() => run({ action: "setTest", on: !user.review_sandbox }, user.review_sandbox ? `Stop treating ${name} as a test account? Their activity will reach real people again.` : `Mark ${name} as a test account? Their emails are held back and their listings and chats are hidden from real users.`, () => "Test account setting updated.")}>
          {user.review_sandbox ? "Unmark as test account" : "Mark as test account"}
        </button>
        {flags.deleted && (
          <button type="button" disabled={busy || !ownDatabase} title={ownDatabase ? undefined : "Restore on the site that owns this database"} className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" onClick={() => run({ action: "restore" }, `Restore ${name}'s account, along with the listings that were taken down with it?`, (r) => `Account restored${r.listingsRestored ? `, with ${r.listingsRestored} listing${r.listingsRestored === 1 ? "" : "s"}` : ""}.`)}>
            Restore account
          </button>
        )}
      </div>
      {notice && <p className="mt-2 text-xs text-green-700">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] text-gray-500">Anything else on the account is under the gear at the top. Every change is kept in the activity log.</p>
    </Card>
  );
}

export default function PersonRecord({ id, dbTarget, isProd, isSuper, refreshKey, onOpenGear }) {
  const [reload, setReload] = useState(0);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    adminFetch(`/api/admin/records/user/${id}`, dbTarget)
      .then((d) => !cancelled && setRecord(d))
      .catch((e) => { if (!cancelled) { setError(e.message); setRecord(null); } });
    return () => { cancelled = true; };
  }, [id, dbTarget, refreshKey, reload]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!record) return <div className="py-20 text-center text-sm text-gray-400">Loading record...</div>;

  const { user, flags, stage, listings, threads, tours, reviews, emails, search, activity } = record;
  const isLandlord = user.role === "landlord" || listings.length > 0;
  const isStudent = user.role === "student";
  const { role, roles, ...row } = user;
  // Saved lease preferences: a list when they picked several, else the single value.
  const pick = (list, one) => (Array.isArray(list) && list.length ? list.join(" or ") : one ?? null);
  const months = pick(user.preferred_lease_months_list, user.preferred_lease_months);
  const beds = pick(user.preferred_beds_list, user.preferred_beds);
  const prefs = [
    user.preferred_move_in_date && `move in ${day(user.preferred_move_in_date)}`,
    months != null && `${months} month lease`,
    beds != null && `${beds} bed`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">
        <AdminLink path={isLandlord ? "people/landlords" : isStudent ? "people/students" : "people/users"} className="underline">
          {isLandlord ? "Landlords" : isStudent ? "Students" : "All users"}
        </AdminLink>{" "}/ {personName(user)}
      </div>

      {flags.deleted && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          This account was deleted on {day(user.deleted_at)}. It is purged for good 30 days after that; until then the person can restore it by signing in.
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold text-gray-900">{personName(user)}</h2>
            <p className="text-sm text-gray-600">{user.email}{user.company_name ? ` · ${user.company_name}` : ""}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge color={ROLE_COLORS[role] ?? "gray"}>{role}</Badge>
              {stage && <Badge color="green" title={stage.detail}>{stage.label}</Badge>}
              {flags.test && <Badge color="purple" title="A house test account, or one flagged for app store review">test account</Badge>}
              {flags.system && <Badge color="purple">system</Badge>}
              {flags.billingOnly && <Badge color="blue" title="Signs and pays for other accounts; has no listings of its own">billing account</Badge>}
              {flags.incomplete && <Badge color="amber">profile not finished</Badge>}
              {flags.unverified && <Badge color="amber">email not verified</Badge>}
              {flags.deleted && <Badge color="red">deleted</Badge>}
            </div>
            {stage && <p className="mt-1 text-xs text-gray-500">{stage.detail}. Worked out from their activity, not set by hand.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {record.ownDatabase ? (
              <>
                <a href={`/dashboard/view-as/${user.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700">View their dashboard</a>
                <a href={`/?messages=1&messagesAs=${user.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Their inbox</a>
              </>
            ) : (
              <span className="text-[11px] text-gray-500">View as works on the site that owns this database.</span>
            )}
            <span title="Edit this account's fields"><GearButton onClick={() => onOpenGear("users", row)} /></span>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
          <Fact label="Joined">{day(user.created_at)}</Fact>
          <Fact label="Phone">{user.phone}</Fact>
          <Fact label="Signs in with">{user.google_account ? "Google" : user.apple_account ? "Apple" : flags.hasPassword ? "Email and password" : "No password yet"}</Fact>
          <Fact label="Email alerts">{user.email_notifications === false ? "Turned off" : "On"}</Fact>
          {isStudent && <Fact label="Graduation">{user.graduation_year ? `${user.graduation_month ?? "?"}/${user.graduation_year}` : null}</Fact>}
          {isStudent && <Fact label="Looking for">{prefs.join(", ")}</Fact>}
          <Fact label="Heard about us from">{user.referral_source}</Fact>
          <Fact label="Id"><span className="font-mono text-xs">{user.id}</span></Fact>
        </dl>
      </section>

      <NotesPanel subjectType="user" subjectId={user.id} dbTarget={dbTarget} />

      {isSuper && <AccountActions user={user} flags={flags} role={role} dbTarget={dbTarget} isProd={isProd} ownDatabase={record.ownDatabase} onDone={() => setReload((n) => n + 1)} />}

      {isLandlord && <OwnedListings listings={listings} />}

      {isLandlord && isSuper && <BillingCard id={user.id} dbTarget={dbTarget} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Conversations" count={threads.length}>
          <ThreadList threads={threads} hide={isLandlord ? "landlord" : "student"} />
        </Card>
        <Card title="Tours" count={tours.length}>
          <TourList tours={tours} hide={isLandlord ? "landlord" : "student"} />
        </Card>
      </div>

      {!isLandlord && (
        <Card title="Search activity">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
            <Fact label="Saved listings">{String(search.interactions.saved)}</Fact>
            <Fact label="Contacted">{String(search.interactions.contacted)}</Fact>
            <Fact label="Listings opened">{String(search.interactions.clicked)}</Fact>
            <Fact label="Find Your Place">{sessionsSummary(search.sessions)}</Fact>
            <Fact label="Lease checks">{search.leaseChecks.length ? `${search.leaseChecks.length}, last ${day(search.leaseChecks[0].at)}` : "0"}</Fact>
          </dl>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reviews written" count={reviews.length}>
          {reviews.length === 0 ? <Empty>No reviews.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {reviews.map((r) => (
                <li key={r.id} className="py-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars rating={r.rating} />
                    {r.listing ? <ListingLink id={r.listing.id}>{r.listing.label}</ListingLink> : <span className="text-gray-500">Listing missing</span>}
                    {!r.verified && !r.deleted && <Badge color="amber">unverified</Badge>}
                    {r.deleted && <Badge color="red">deleted</Badge>}
                    <span className="ml-auto text-xs text-gray-500">{day(r.createdAt)}</span>
                  </div>
                  {r.comment && <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Emails sent to them" count={emails.total} action={<AdminLink path="email/sent" params={{ q: user.email ?? "" }} className="text-xs text-gray-600 underline">See all</AdminLink>}>
          {emails.recent.length === 0 ? <Empty>No emails.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {emails.recent.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-800">{e.subject}</span>
                  <Badge color={EMAIL_PROBLEMS.has(e.status) ? "red" : e.status === "delivered" ? "green" : "gray"}>{e.status}</Badge>
                  <span className="text-xs text-gray-500">{dayTime(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="What they changed" count={activity.length}>
        <ActivityList rows={activity} />
      </Card>
    </div>
  );
}
