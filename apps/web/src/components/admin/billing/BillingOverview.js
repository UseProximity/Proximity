"use client";

/*
 * Billing > Overview (Wyatt, 2026-11-14): the whole of billing on one screen.
 * What is waiting on the team, where the money is in its pipeline, how ready
 * the landlords are, and how the switches are set. Every tile opens the
 * sub-tab where that thing is handled.
 */
import { useEffect, useState } from "react";
import { fmtDate } from "@/components/admin/adminShared";
import { billingFetch } from "@/components/admin/billing/billingFetch";

const usd = (cents) => `$${(Number(cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// "2026-11-01" -> "November 2026"
const period = (p) => (/^\d{4}-\d{2}/.test(p ?? "") ? new Date(`${p.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "the current period");

async function get(url) {
  const res = await billingFetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function Tile({ value, label, hint, tone = "plain", onClick }) {
  const tones = { alert: "border-amber-300 bg-amber-50", plain: "border-gray-200 bg-white", quiet: "border-gray-200 bg-white" };
  return (
    <button type="button" onClick={onClick} className={`rounded-xl border p-3 text-left transition-colors hover:border-gray-400 ${tones[tone]}`}>
      <span className={`block text-2xl font-semibold ${tone === "quiet" ? "text-gray-300" : "text-gray-900"}`}>{value}</span>
      <span className="block text-sm font-medium text-gray-900">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{hint}</span>}
    </button>
  );
}

function Group({ title, note, children }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {note && <p className="mb-2 text-xs text-gray-500">{note}</p>}
      {children}
    </section>
  );
}

function Switch({ label, on, detail, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50">
      <span className={`w-10 flex-shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-bold ${on ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-500"}`}>{on ? "ON" : "OFF"}</span>
      <span className="min-w-0 flex-1"><span className="block font-medium text-gray-900">{label}</span><span className="block text-xs text-gray-500">{detail}</span></span>
      <span className="text-xs text-gray-400">Change</span>
    </button>
  );
}

export default function BillingOverview({ queues, onOpen }) {
  const [more, setMore] = useState({});

  // Each part loads by itself, so a slow or failing one does not hold up the rest.
  useEffect(() => {
    let cancelled = false;
    const put = (key) => (value) => !cancelled && setMore((m) => ({ ...m, [key]: value }));
    get("/api/admin/billing/summary").then(put("money")).catch(() => put("money")({ failed: true }));
    get("/api/admin/billing/landlords?filter=all&view=summary").then(put("landlords")).catch(() => put("landlords")({ failed: true }));
    get("/api/admin/billing/run-settings").then(put("run")).catch(() => put("run")({ failed: true }));
    get("/api/admin/billing/enrollment?view=window").then(put("enrollment")).catch(() => put("enrollment")({ failed: true }));
    return () => { cancelled = true; };
  }, []);

  const { money, landlords, run, enrollment } = more;
  const charge = (status) => money?.charges?.[status] ?? { count: 0, cents: 0 };
  const invoice = (status) => money?.invoices?.[status] ?? { count: 0, cents: 0 };
  const loading = <p className="text-sm text-gray-400">Loading...</p>;
  const failed = <p className="text-sm text-red-700">Could not load this part.</p>;

  const waiting = [
    ["confirm", queues.confirm, "Charges to confirm", "A new charge waits here until a team member confirms it. Only then does the landlord see it."],
    ["contest", queues.contest, "Contested charges", "A landlord disputed a charge and is waiting for a decision."],
    ["invoices", queues.invoices, "Failed or overdue invoices", "A payment failed, or an invoice is past due."],
    ["chargebacks", queues.chargebacks, "Chargebacks", "A landlord's bank reversed a payment. Answered in Stripe."],
    ["changes", queues.changes, "Agreement change requests", "A landlord asked for different wording and waits on us."],
  ];
  const steps = [
    ["unconfirmed", "To confirm", "confirm"],
    ["pending", "In 7 day review", "charges"],
    ["approved", "Approved, not billed yet", "charges"],
    ["invoiced", "On an invoice", "charges"],
    ["paid", "Paid", "charges"],
  ];
  const c = landlords?.counts;

  return (
    <div className="space-y-6">
      <Group title="Waiting on the team" note="Nothing moves on these until someone here acts.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {waiting.map(([tab, n, label, hint]) => <Tile key={tab} value={n} label={label} hint={hint} tone={n > 0 ? "alert" : "quiet"} onClick={() => onOpen(tab)} />)}
        </div>
      </Group>

      <Group title="Where the money is" note="Each charge moves left to right. Test charges are not counted.">
        {!money ? loading : money.failed ? failed : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {steps.map(([status, label, tab], i) => (
                <Tile key={status} value={usd(charge(status).cents)} label={`${i + 1}. ${label}`} hint={`${charge(status).count} charge${charge(status).count === 1 ? "" : "s"}`} tone={charge(status).count ? "plain" : "quiet"} onClick={() => onOpen(tab)} />
              ))}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Off the path: {charge("contested").count} contested ({usd(charge("contested").cents)}), {charge("voided").count} voided ({usd(charge("voided").cents)}).{" "}
              Invoices: {invoice("open").count + invoice("processing").count} unpaid ({usd(invoice("open").cents + invoice("processing").cents)}), {invoice("failed").count} failed ({usd(invoice("failed").cents)}), {invoice("paid").count} paid ({usd(invoice("paid").cents)}).{" "}
              <button type="button" className="underline" onClick={() => onOpen("all-invoices")}>See every invoice</button>
            </p>
          </>
        )}
      </Group>

      <Group title="Landlords" note={c ? `Across all ${c.all} landlord accounts, whether or not they have something live.` : null}>
        {!landlords ? loading : landlords.failed ? failed : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile value={c.live} label="With a live listing" hint={`Out of ${c.all} landlord accounts.`} onClick={() => onOpen("agreements")} />
            <Tile value={c.unsigned} label="Have not signed" hint="No signed marketing agreement yet." tone={c.unsigned ? "alert" : "quiet"} onClick={() => onOpen("agreements")} />
            <Tile value={c.no_method} label="No payment method" hint="Nothing on file to bill." tone={c.no_method ? "alert" : "quiet"} onClick={() => onOpen("agreements")} />
            <Tile value={c.blocked} label="Blocked from publishing" hint="Missing what the publishing rules require." tone={c.blocked ? "alert" : "quiet"} onClick={() => onOpen("agreements")} />
            <Tile value={c.uncovered} label="With properties not covered" hint="Live properties their signed agreement does not list." tone={c.uncovered ? "alert" : "quiet"} onClick={() => onOpen("agreements")} />
          </div>
        )}
      </Group>

      <Group title="How billing is set" note="The switches and dates that decide what happens automatically.">
        <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {!run ? <div className="px-3 py-2">{loading}</div> : run.failed ? <div className="px-3 py-2">{failed}</div> : (
            <Switch label="Automatic monthly billing" on={run.enabled} detail={`Next billing day ${run.nextBillingDay ? fmtDate(`${run.nextBillingDay}T12:00:00Z`) : "not set"}, for ${period(run.billingPeriod)}.${run.enabled ? "" : " While off, no real invoices are created."}`} onClick={() => onOpen("run")} />
          )}
          {landlords && !landlords.failed && (
            <>
              <Switch label="Publishing needs a payment method" on={!!landlords.settings?.requirePaymentMethod} detail="A landlord without one cannot publish a new listing, unit or offering." onClick={() => onOpen("rules")} />
              <Switch label="Publishing needs a signed agreement" on={!!landlords.settings?.requireAgreement} detail={landlords.liveVersion ? `Live agreement: ${landlords.liveVersion.label ?? "unnamed version"}${landlords.liveVersion.publishedAt ? `, since ${fmtDate(landlords.liveVersion.publishedAt)}` : ""}.` : "No agreement version is live yet."} onClick={() => onOpen("rules")} />
            </>
          )}
          {enrollment && !enrollment.failed && (
            <Switch label="Launch enrollment deadline" on={!!enrollment.deadline} detail={enrollment.deadline ? `${fmtDate(`${enrollment.deadline}T12:00:00Z`)}. The publishing rules turn on by themselves that day.` : "No deadline set, so the publishing rules only change by hand."} onClick={() => onOpen("enrollment")} />
          )}
        </div>
      </Group>
    </div>
  );
}
