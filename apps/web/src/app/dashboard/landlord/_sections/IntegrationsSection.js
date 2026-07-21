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
import { CheckCircle2, Link2, Loader2, Plug, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import Nango from "@nangohq/frontend";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";

const PROVIDERS = [
  { key: "buildium", label: "Buildium", note: "Open API access (Premium plan) required" },
  { key: "appfolio", label: "AppFolio", note: "Plus or Max plan — read-only reporting access" },
  { key: "doorloop", label: "DoorLoop", note: "API keys are available on the Premium plan" },
];

export default function IntegrationsSection() {
  const [connections, setConnections] = useState(null);
  const [connecting, setConnecting] = useState(null); // provider key while widget open
  const [consented, setConsented] = useState(false);
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
    } catch {
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function runDiscover(provider, nangoConnectionId) {
    setError(null);
    try {
      const res = await fetch("/api/landlord/pms/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, nangoConnectionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Discovery failed");
      setDiscovery(data);
      // Sensible defaults: high-confidence match -> link; near campus -> add; far -> skip.
      const initial = {};
      for (const p of data.properties) {
        initial[p.externalPropertyId] = p.match
          ? { action: "link", listingId: p.match.listingId }
          : { action: p.withinRadius ? "ingest" : "exclude" };
      }
      setDecisions(initial);
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(null);
    }
  }

  function startConnect(provider) {
    setError(null);
    setConnecting(provider);
    const nango = new Nango();
    const connect = nango.openConnectUI({
      onEvent: (event) => {
        if (event.type === "connect") {
          runDiscover(provider, event.payload.connectionId);
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
          decisions: Object.entries(decisions).map(([externalPropertyId, d]) => ({
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
            Confirm once — after this, availability and pricing stay in sync automatically.
          </p>
        </div>

        {discovery.properties.map((p) => {
          const d = decisions[p.externalPropertyId] || { action: "exclude" };
          return (
            <Card key={p.externalPropertyId}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-gray-900">{p.name || p.address || "Unnamed property"}</div>
                    <div className="text-sm text-gray-600">{p.address}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {p.unitCount} unit{p.unitCount === 1 ? "" : "s"}
                      {p.availableUnits > 0 && ` · ${p.availableUnits} available now`}
                      {p.distanceKm != null && ` · ${p.distanceKm} km from campus`}
                    </div>
                  </div>
                  {!p.withinRadius && (
                    <Badge variant="outline" className="shrink-0">Outside the WashU area</Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {p.match && (
                    <button
                      onClick={() =>
                        setDecisions((prev) => ({
                          ...prev,
                          [p.externalPropertyId]: { action: "link", listingId: p.match.listingId },
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                        d.action === "link"
                          ? "bg-red-600 text-white border-red-600"
                          : "border-gray-300 text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      Same as “{p.match.title || p.match.address}”
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setDecisions((prev) => ({ ...prev, [p.externalPropertyId]: { action: "ingest" } }))
                    }
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      d.action === "ingest"
                        ? "bg-red-600 text-white border-red-600"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Add as a new listing
                  </button>
                  <button
                    onClick={() =>
                      setDecisions((prev) => ({ ...prev, [p.externalPropertyId]: { action: "exclude" } }))
                    }
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      d.action === "exclude"
                        ? "bg-gray-800 text-white border-gray-800"
                        : "border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Don’t sync
                  </button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={submitDecisions} disabled={confirming} className="bg-red-600 hover:bg-red-700">
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Setting up…
              </>
            ) : (
              "Confirm and start syncing"
            )}
          </Button>
          <Button variant="outline" onClick={() => setDiscovery(null)} disabled={confirming}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ---------- main screen ----------
  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Property management sync</h1>
        <p className="text-sm text-gray-600 mt-1">
          Connect your property management system once. Leased units come off Proximity
          automatically, freed-up units go live the moment they open up, and students see
          availability verified straight from your system — no more “is this still available?”
          emails.
        </p>
      </div>

      {confirmResults && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-700 font-medium">
              <CheckCircle2 className="h-5 w-5" /> Sync is set up
            </div>
            <ul className="text-sm text-gray-700 mt-2 space-y-1">
              {confirmResults.map((r, i) => (
                <li key={i}>
                  {r.ok
                    ? r.action === "ingest"
                      ? "New listing created from your PMS"
                      : r.action === "link"
                        ? "Linked to your existing listing"
                        : "Excluded from sync"
                    : `One property failed: ${r.error}`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {connections.length > 0 && (
        <div className="space-y-4">
          {connections.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Plug className="h-4 w-4 text-red-600" />
                    {PROVIDERS.find((p) => p.key === c.provider)?.label || c.provider}
                    {c.credential_meta?.accountLabel && (
                      <span className="text-gray-500 font-normal">· {c.credential_meta.accountLabel}</span>
                    )}
                  </span>
                  <Badge variant={c.status === "active" ? "default" : "outline"}>{c.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-gray-500">
                  {c.last_sync_at
                    ? `Last synced ${new Date(c.last_sync_at).toLocaleString()} — ${c.last_sync_status || "ok"}`
                    : "First sync runs tonight"}
                  {c.last_sync_error && ` · ${c.last_sync_error}`}
                </p>
                {c.links.filter((l) => l.include && l.listing).length > 0 && (
                  <ul className="text-sm text-gray-700 space-y-1">
                    {[...new Map(c.links.filter((l) => l.include && l.listing).map((l) => [l.listing_id, l])).values()].map((l) => (
                      <li key={l.listing_id} className="flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5 text-gray-400" />
                        {l.listing.title || l.listing.address}
                        {l.listing.unavailable ? (
                          <Badge variant="outline">unavailable</Badge>
                        ) : (
                          <Badge variant="secondary">live</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  These listings update from your property manager — availability and pricing are
                  applied automatically every day.
                </p>
                <Button variant="outline" size="sm" onClick={() => disconnect(c.id)}>
                  <Unplug className="h-3.5 w-3.5 mr-1.5" /> Disconnect
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {connections.length ? "Connect another system" : "Connect your system"}
        </h2>

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I authorize Proximity to <strong>read</strong> property, unit, pricing, and availability
            data from my property management system via Nango. Proximity never sees my login or API
            keys, can’t change anything in my system, and I can disconnect anytime.
          </span>
        </label>

        <div className="grid sm:grid-cols-3 gap-3">
          {PROVIDERS.map((p) => (
            <Card key={p.key} className="flex flex-col">
              <CardContent className="p-4 flex flex-col flex-1 gap-2">
                <div className="font-semibold text-gray-900">{p.label}</div>
                <p className="text-xs text-gray-500 flex-1">{p.note}</p>
                <Button
                  size="sm"
                  disabled={!consented || connecting === p.key}
                  onClick={() => startConnect(p.key)}
                  className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  {connecting === p.key ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Connecting…
                    </>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          Read-only. Your credentials are stored by Nango, our secure connection provider — never by
          Proximity. Your listing descriptions and photos are never overwritten.
        </p>
        {error && !discovery && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
