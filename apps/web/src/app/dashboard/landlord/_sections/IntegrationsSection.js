"use client";

/*
 * Landlord dashboard — "Sync your PMS" section.
 *
 * Flow: pick provider → Nango Connect widget (credential entered in Nango's
 * hosted window, never ours) → discover (radius-filtered snapshot + dedupe
 * suggestions against the landlord's own listings) → one-time confirm →
 * listings self-maintain via the daily sync.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Home, Link2, Loader2, Plug, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import Image from "next/image";
import Nango from "@nangohq/frontend";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";

const PROVIDERS = [
  { key: "buildium", label: "Buildium", logo: "/pms-logos/buildium.png", note: "Premium plan required" },
  { key: "appfolio", label: "AppFolio", logo: "/pms-logos/appfolio.png", note: "Plus or Max plan required" },
  { key: "doorloop", label: "DoorLoop", logo: "/pms-logos/doorloop.png", note: "Premium plan required" },
  { key: "rentec", label: "Rentec Direct", logo: "/pms-logos/rentecdirect.png", note: "Pro or PM plan required" },
];

// Accepts "acme", "acme.appfolio.com", or a full pasted AppFolio URL; returns
// the bare database name or null. Any other host (dots that aren't the
// .appfolio.com suffix) is rejected, matching the server-side SSRF check in
// lib/pms/appfolio.js.
function parseAppfolioDb(input) {
  const host = String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  const cleaned = host.replace(/\.appfolio\.com$/, "");
  return /^[a-z0-9-]{1,63}$/.test(cleaned) ? cleaned : null;
}

// "2 BR" / "1 to 4 BR" / "$950" / "$950 to $1,400" summaries for match cards.
function formatRange([lo, hi], format) {
  if (lo == null && hi == null) return null;
  const a = lo ?? hi;
  const b = hi ?? lo;
  return Number(a) === Number(b) ? format(a) : `${format(a)} to ${format(b)}`;
}
const formatBeds = (range) => formatRange(range, (n) => `${n} BR`);
const formatRent = (range) => formatRange(range, (n) => `$${Math.round(n).toLocaleString()}`);

// Visible radio circle so every confirm choice reads as one option set.
function RadioDot({ on }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        on ? "border-red-600" : "border-gray-300"
      }`}
    >
      {on && <span className="h-2 w-2 rounded-full bg-red-600" />}
    </span>
  );
}

export default function IntegrationsSection() {
  const [connections, setConnections] = useState(null);
  const [allowDemo, setAllowDemo] = useState(false);
  const [connecting, setConnecting] = useState(null); // provider key while widget open
  const [syncedProvider, setSyncedProvider] = useState(null); // provider just set up (for the summary)
  const [requestName, setRequestName] = useState("");
  const [requestState, setRequestState] = useState(null); // null | "sending" | "sent" | "error"
  const [consented, setConsented] = useState(false);
  const [appfolioSetup, setAppfolioSetup] = useState(false); // AppFolio pre-connect step open
  const [appfolioDb, setAppfolioDb] = useState("");
  const [discovery, setDiscovery] = useState(null); // discover response
  const [decisions, setDecisions] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [confirmResults, setConfirmResults] = useState(null);
  const [error, setError] = useState(null);

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/landlord/pms/links");
      const data = await res.json();
      setConnections(res.ok ? data.connections : []);
      setAllowDemo(res.ok ? !!data.allowDemo : false);
    } catch {
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function runDiscover(provider, nangoConnectionId, subdomain = null) {
    setError(null);
    setSyncedProvider(provider);
    try {
      const res = await fetch("/api/landlord/pms/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, nangoConnectionId, ...(subdomain ? { subdomain } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discovery failed");
      setDiscovery(data);
      // Sensible defaults: a single match -> link it; near campus -> add;
      // far -> skip. When SEVERAL of the landlord's listings match one
      // property (same address twice, e.g. a building and its sublease),
      // nothing is preselected: auto-guessing could silently link the wrong
      // one, so the landlord must pick before Confirm unlocks.
      const initial = {};
      for (const p of data.properties) {
        const matches = p.matches ?? (p.match ? [p.match] : []);
        initial[p.externalPropertyId] =
          matches.length > 1
            ? { action: null }
            : matches.length === 1
              ? { action: "link", listingId: matches[0].listingId }
              : { action: p.withinRadius ? "ingest" : "exclude" };
      }
      setDecisions(initial);
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(null);
    }
  }

  function startConnect(provider, subdomain = null) {
    setError(null);
    setConnecting(provider);
    const nango = new Nango();
    const connect = nango.openConnectUI({
      onEvent: (event) => {
        if (event.type === "connect") {
          runDiscover(provider, event.payload.connectionId, subdomain);
        } else if (event.type === "close") {
          setConnecting((current) => (current === provider ? null : current));
        }
      },
    });
    fetch("/api/landlord/pms/connect-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start the connection");
        connect.setSessionToken(data.token);
      })
      .catch((err) => {
        setError(err.message);
        setConnecting(null);
        try {
          connect.close();
        } catch {}
      });
  }

  async function submitDecisions() {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/landlord/pms/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: discovery.connectionId,
          decisions: Object.entries(decisions)
            .filter(([, d]) => d?.action)
            .map(([externalPropertyId, d]) => ({
              externalPropertyId,
              ...d,
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your choices");
      setConfirmResults(data.results);
      setDiscovery(null);
      loadConnections();
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  }

  async function submitIntegrationRequest(e) {
    e.preventDefault();
    if (!requestName.trim() || requestState === "sending") return;
    setRequestState("sending");
    try {
      const res = await fetch("/api/landlord/pms/request-integration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: requestName.trim() }),
      });
      setRequestState(res.ok ? "sent" : "error");
    } catch {
      setRequestState("error");
    }
  }

  async function disconnect(connectionId) {
    if (!window.confirm("Disconnect? Your listings stay up, but they stop updating automatically and lose the live-verified badge.")) return;
    await fetch(`/api/landlord/pms/connect?connectionId=${connectionId}`, { method: "DELETE" });
    loadConnections();
  }

  if (connections === null) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  // ---------- discover / confirm screen ----------
  if (discovery) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Found {discovery.properties.length} propert{discovery.properties.length === 1 ? "y" : "ies"}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Confirm once. After this, availability and pricing stay in sync automatically.
          </p>
        </div>

        {discovery.properties.map((p) => {
          const d = decisions[p.externalPropertyId] || { action: "exclude" };
          const matches = p.matches ?? (p.match ? [p.match] : []);
          return (
            <Card key={p.externalPropertyId} className="rounded-xl">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 leading-tight">
                      {p.name || p.address || "Unnamed property"}
                    </div>
                    {p.address && <div className="mt-0.5 text-sm text-gray-600">{p.address}</div>}
                    <div className="mt-1.5 text-xs text-gray-500">
                      {p.unitCount} unit{p.unitCount === 1 ? "" : "s"}
                      {p.availableUnits > 0 && ` · ${p.availableUnits} available now`}
                      {p.distanceKm != null && ` · ${p.distanceKm} km from campus`}
                    </div>
                  </div>
                  {!p.withinRadius && (
                    <Badge variant="outline" className="shrink-0">Outside the WashU area</Badge>
                  )}
                </div>

                {/* Radio-group semantics: exactly one decision per property.
                    With matches, ALL THREE choices render as one radio list
                    (cards + two text rows) so "same as existing" is obviously
                    an option; without matches, the two chips suffice. */}
                <div
                  role="radiogroup"
                  aria-label={`What should we do with ${p.name || p.address || "this property"}?`}
                  className="space-y-3"
                >
                  {matches.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        {matches.length === 1
                          ? "Is this one of your listings?"
                          : `${matches.length} of your listings are at this address. Which one is it?`}
                      </p>
                      {matches.map((m) => {
                        const selected = d.action === "link" && d.listingId === m.listingId;
                        const meta = [
                          m.landlords?.length ? m.landlords.join(", ") : null,
                          formatBeds(m.bedrooms || []),
                          formatRent(m.rent || []),
                        ].filter(Boolean);
                        return (
                          <div
                            key={m.listingId}
                            className={`flex items-center gap-3 rounded-xl border p-2.5 transition-colors ${
                              selected
                                ? "border-red-600 bg-red-50/50 ring-1 ring-red-600"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <button
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [p.externalPropertyId]: { action: "link", listingId: m.listingId },
                                }))
                              }
                              className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 rounded-lg"
                            >
                              <RadioDot on={selected} />
                              {m.coverUrl ? (
                                <Image
                                  src={m.coverUrl}
                                  alt=""
                                  width={96}
                                  height={96}
                                  className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-cover"
                                />
                              ) : (
                                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400">
                                  <Home className="h-5 w-5" />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate text-sm font-medium text-gray-900">
                                    {m.title || m.address}
                                  </span>
                                  {m.sublease && (
                                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                      Sublease
                                    </span>
                                  )}
                                  {m.unavailable && (
                                    <Badge variant="outline" className="shrink-0">Marked unavailable</Badge>
                                  )}
                                  {m.alreadySynced && (
                                    <Badge variant="outline" className="shrink-0">Already syncing</Badge>
                                  )}
                                </span>
                                {m.address && (
                                  <span className="mt-0.5 block truncate text-xs text-gray-500">{m.address}</span>
                                )}
                                {meta.length > 0 && (
                                  <span className="mt-0.5 block truncate text-xs text-gray-500">
                                    {meta.join(" · ")}
                                  </span>
                                )}
                              </span>
                            </button>
                            <a
                              href={`/listings/${m.listingId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${m.title || m.address} in a new tab`}
                              className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        );
                      })}

                      {/* Same option set, continued: not-mine and don't-sync
                          as radio rows so all three choices read as one list. */}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={d.action === "ingest"}
                        onClick={() =>
                          setDecisions((prev) => ({ ...prev, [p.externalPropertyId]: { action: "ingest" } }))
                        }
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 ${
                          d.action === "ingest"
                            ? "border-red-600 bg-red-50/50 ring-1 ring-red-600 text-gray-900"
                            : "border-gray-200 text-gray-700 hover:border-gray-300"
                        }`}
                      >
                        <RadioDot on={d.action === "ingest"} />
                        <span>
                          <span className="font-medium">It&apos;s not on Proximity yet.</span>{" "}
                          Create a separate new listing.
                        </span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={d.action === "exclude"}
                        onClick={() =>
                          setDecisions((prev) => ({ ...prev, [p.externalPropertyId]: { action: "exclude" } }))
                        }
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 ${
                          d.action === "exclude"
                            ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900 text-gray-900"
                            : "border-gray-200 text-gray-700 hover:border-gray-300"
                        }`}
                      >
                        <RadioDot on={d.action === "exclude"} />
                        <span>Don&apos;t sync this property.</span>
                      </button>
                    </div>
                  )}

                  {matches.length === 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={d.action === "ingest"}
                        onClick={() =>
                          setDecisions((prev) => ({ ...prev, [p.externalPropertyId]: { action: "ingest" } }))
                        }
                        className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                          d.action === "ingest"
                            ? "border-red-600 bg-red-600 text-white focus-visible:ring-red-500"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400"
                        }`}
                      >
                        Add as a new listing
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={d.action === "exclude"}
                        onClick={() =>
                          setDecisions((prev) => ({ ...prev, [p.externalPropertyId]: { action: "exclude" } }))
                        }
                        className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                          d.action === "exclude"
                            ? "border-gray-900 bg-gray-900 text-white focus-visible:ring-gray-500"
                            : "border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400"
                        }`}
                      >
                        Don&apos;t sync
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {(() => {
          const unresolved = discovery.properties.filter(
            (p) => !decisions[p.externalPropertyId]?.action
          ).length;
          return (
            <>
              {unresolved > 0 && (
                <p className="text-sm text-gray-600">
                  {unresolved === 1
                    ? "1 property has more than one possible listing. Pick the right one above to continue."
                    : `${unresolved} properties have more than one possible listing. Pick the right ones above to continue.`}
                </p>
              )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={submitDecisions}
            disabled={confirming || unresolved > 0}
            className="h-11 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Setting up…
              </>
            ) : (
              "Confirm and start syncing"
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setDiscovery(null)}
            disabled={confirming}
            className="h-11 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
          >
            Cancel
          </Button>
        </div>
            </>
          );
        })()}
      </div>
    );
  }

  // ---------- main screen ----------
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <p className="text-sm text-gray-600">
          Connect your property management system once. Leased units come off Proximity
          automatically, freed-up units go live the moment they open up, and students see
          availability verified straight from your system.
        </p>
      </div>

      {confirmResults && (() => {
        const created = confirmResults.filter((r) => r.ok && r.action === "ingest" && !r.reused).length;
        const reused = confirmResults.filter((r) => r.ok && r.reused).length;
        const linked = confirmResults.filter((r) => r.ok && r.action === "link").length;
        const failed = confirmResults.filter((r) => !r.ok).length;
        const name = PROVIDERS.find((p) => p.key === syncedProvider)?.label || "your PMS";
        return (
          <Card className="rounded-xl border-green-200 bg-green-50/50">
            <CardContent className="flex items-start gap-3 p-5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              <div className="space-y-1">
                <div className="font-semibold text-gray-900">Sync is set up</div>
                <div className="space-y-0.5 text-sm text-gray-700">
                  {created > 0 && (
                    <p>{created} new listing{created === 1 ? "" : "s"} created from {name}</p>
                  )}
                  {linked > 0 && (
                    <p>{linked} {linked === 1 ? "listing" : "listings"} linked to your existing {linked === 1 ? "listing" : "listings"}</p>
                  )}
                  {reused > 0 && (
                    <p>{reused} {reused === 1 ? "listing was" : "listings were"} already synced</p>
                  )}
                  {failed > 0 && (
                    <p className="text-red-600">{failed} {failed === 1 ? "property" : "properties"} could not be set up</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {connections.length > 0 && (
        <div className="space-y-4">
          {connections.map((c) => (
            <Card key={c.id} className="rounded-xl">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white"
                    >
                      <Plug className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 leading-tight">
                        {PROVIDERS.find((p) => p.key === c.provider)?.label || c.provider}
                      </div>
                      {c.credential_meta?.accountLabel && (
                        <div className="truncate text-xs text-gray-500">
                          {c.credential_meta.accountLabel}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant={c.status === "active" ? "default" : "outline"} className="shrink-0 capitalize">
                    {c.status}
                  </Badge>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <RefreshCw className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span>
                    {c.last_sync_at
                      ? `Last synced ${new Date(c.last_sync_at).toLocaleString()} · ${c.last_sync_status || "ok"}`
                      : "First sync is running now"}
                    {c.last_sync_error && ` · ${c.last_sync_error}`}
                  </span>
                </div>

                {c.links.filter((l) => l.include && l.listing).length > 0 && (
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {[...new Map(c.links.filter((l) => l.include && l.listing).map((l) => [l.listing_id, l])).values()].map((l) => (
                      <li key={l.listing_id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-gray-700">
                          <Link2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          <span className="truncate">{l.listing.title || l.listing.address}</span>
                        </span>
                        {l.listing.unavailable ? (
                          <Badge variant="outline" className="shrink-0">unavailable</Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">live</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-xs leading-relaxed text-gray-500">
                    Availability and pricing are applied automatically every day.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disconnect(c.id)}
                    className="h-9 shrink-0 text-gray-600 hover:text-gray-900 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                  >
                    <Unplug className="h-3.5 w-3.5 mr-1.5" /> Disconnect
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">
            {connections.length ? "Connect another system" : "Connect your system"}
          </h2>
          <p className="text-sm text-gray-500">
            Pick your property management software to start syncing availability.
          </p>
        </div>

        {/* Consent gate. The Connect buttons stay disabled until this is
            checked, so the reason is stated right here rather than leaving a
            dead-looking button. */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm transition-colors cursor-pointer ${
            consented ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 hover:bg-gray-100/70"
          }`}
        >
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          />
          <span className="text-gray-700 leading-relaxed">
            I authorize Proximity to <strong className="font-semibold text-gray-900">read</strong>{" "}
            property, unit, pricing, and availability data from my property management system via
            Nango. Proximity never sees my login or API keys, can&apos;t change anything in my
            system, and I can disconnect anytime.
          </span>
        </label>

        {/* AppFolio needs one extra fact before the Nango window opens: the
            database (subdomain). Nango's hosted form has no field for it, and
            its generic labels say Username/Password, so both are explained here. */}
        {appfolioSetup && (
          <Card className="rounded-xl border-gray-300">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-1">
                <div className="text-sm font-semibold text-gray-900">Connect AppFolio</div>
                <p className="text-xs leading-relaxed text-gray-500">
                  In AppFolio, open General Settings, then Manage API Settings, then the Reports
                  API Credentials tab. If credentials are already listed, copy those. Only
                  generate new ones if the section is empty, since generating a new pair
                  disconnects any other tool using the old one.
                </p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="appfolio-db" className="block text-sm font-medium text-gray-900">
                  Your AppFolio database name
                </label>
                <input
                  id="appfolio-db"
                  type="text"
                  value={appfolioDb}
                  onChange={(e) => setAppfolioDb(e.target.value)}
                  placeholder="e.g. acmeproperties"
                  maxLength={120}
                  autoFocus
                  className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                />
                <p className="text-xs text-gray-500">
                  The part before .appfolio.com in your AppFolio URL. Pasting the full URL works
                  too.
                </p>
              </div>
              <p className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs leading-relaxed text-gray-600">
                Next, a secure window asks for a Username and Password. Enter your AppFolio
                Client ID as the username and your Client Secret as the password.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  disabled={!parseAppfolioDb(appfolioDb) || connecting === "appfolio"}
                  onClick={() => {
                    const db = parseAppfolioDb(appfolioDb);
                    if (!db) return;
                    setAppfolioSetup(false);
                    startConnect("appfolio", db);
                  }}
                  className="h-11 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                >
                  Continue to connect
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAppfolioSetup(false)}
                  className="h-11 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          {PROVIDERS.map((p) => {
            const busy = connecting === p.key;
            return (
              <Card
                key={p.key}
                className="flex flex-col rounded-xl transition-all duration-200 hover:border-gray-300 hover:shadow-md"
              >
                <CardContent className="flex flex-1 flex-col gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <Image
                      src={p.logo}
                      alt=""
                      width={36}
                      height={36}
                      aria-hidden="true"
                      className="h-9 w-9 shrink-0 rounded-lg border border-gray-200 bg-white object-contain p-1"
                    />
                    <span className="font-semibold text-gray-900 leading-tight">{p.label}</span>
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-gray-500">{p.note}</p>
                  <Button
                    disabled={!consented || busy}
                    onClick={() => {
                      if (p.key === "appfolio") {
                        setError(null);
                        setAppfolioSetup(true);
                      } else {
                        startConnect(p.key);
                      }
                    }}
                    aria-label={`Connect ${p.label}`}
                    className="h-11 w-full focus-visible:ring-red-500 focus-visible:ring-offset-2"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Connecting…
                      </>
                    ) : (
                      "Connect"
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
          <ShieldCheck className="h-4 w-4 shrink-0 text-gray-400 mt-px" />
          <span>
            Read-only. Your credentials are stored by Nango, our secure connection provider, never
            by Proximity. Your listing descriptions and photos are never overwritten.
          </span>
        </p>

        {/* Landlords on unsupported systems tell us which one, so we can
            prioritize (and negotiate) the next connector. */}
        <Card className="rounded-xl border-dashed bg-gray-50/60">
          <CardContent className="p-5">
            {requestState === "sent" ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <div>
                  <div className="text-sm font-semibold text-gray-900">Request received</div>
                  <p className="mt-0.5 text-sm text-gray-600">
                    We&apos;ll reach out when {requestName.trim()} is supported.
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={submitIntegrationRequest} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="pms-request" className="block text-sm font-semibold text-gray-900">
                    Don&apos;t see your property management system?
                  </label>
                  <p className="text-xs text-gray-500">
                    Tell us which one you use and we&apos;ll prioritize building it.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="pms-request"
                    type="text"
                    value={requestName}
                    onChange={(e) => setRequestName(e.target.value)}
                    placeholder="e.g. Entrata, Rent Manager, TenantCloud"
                    maxLength={80}
                    className="h-11 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/30"
                  />
                  <Button
                    type="submit"
                    disabled={requestState === "sending" || requestName.trim().length < 2}
                    className="h-11 shrink-0 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                  >
                    {requestState === "sending" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Sending…
                      </>
                    ) : (
                      "Request integration"
                    )}
                  </Button>
                </div>
              </form>
            )}
            {requestState === "error" && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                Something went wrong. Please try again.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Staging/local only: click through the whole flow with sample data, no PMS needed */}
        {allowDemo && (
          <Card className="rounded-xl border-dashed">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">Demo mode</span>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    Not on the live site
                  </Badge>
                </div>
                <p className="max-w-md text-xs leading-relaxed text-gray-500">
                  Try the full flow with sample WashU-area properties. No PMS account or Nango
                  setup needed.
                </p>
              </div>
              <Button
                variant="outline"
                disabled={connecting === "demo"}
                onClick={() => {
                  setConnecting("demo");
                  runDiscover("buildium", "mock-demo");
                }}
                className="h-11 shrink-0 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
              >
                {connecting === "demo" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
                  </>
                ) : (
                  "Try the demo"
                )}
              </Button>
            </CardContent>
          </Card>
        )}
        {error && !discovery && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
