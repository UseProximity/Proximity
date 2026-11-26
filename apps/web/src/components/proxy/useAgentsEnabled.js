"use client";

/*
 * Whether the per-listing agents are switched on (LISTING_AGENTS_ENABLED).
 * Agent-only UI (the landlord Questions and Tours tabs, the "Inquiries"
 * wording) stays hidden until it says yes, so merging ships nothing visible
 * while the switch is off (PR #365 review). Asked once per page load.
 */
import { useEffect, useState } from "react";

let cached = null;
let inflight = null;

export default function useAgentsEnabled() {
  const [enabled, setEnabled] = useState(cached);
  useEffect(() => {
    if (cached !== null) return;
    inflight ??= fetch("/api/agents/enabled")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => (cached = d?.enabled === true))
      .catch(() => (cached = false));
    let alive = true;
    inflight.then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);
  return enabled === true;
}
